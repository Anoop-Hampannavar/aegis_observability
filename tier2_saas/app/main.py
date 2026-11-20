import asyncio
import json
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiosqlite
import numpy as np
import uvicorn
import os
import database
import auth
import aiops

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, tenant_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(tenant_id, []).append(websocket)

    def disconnect(self, tenant_id: str, websocket: WebSocket):
        if tenant_id in self.active_connections and websocket in self.active_connections[tenant_id]:
            self.active_connections[tenant_id].remove(websocket)

    async def broadcast_to_tenant(self, tenant_id: str, message: dict):
        for ws in list(self.active_connections.get(tenant_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(tenant_id, ws)

manager = ConnectionManager()
DUPLICATES_BLOCKED = 0

async def collector_heartbeat_watchdog():
    """Marks any collector silent for >60s as Poor (Stale Data Protection)."""
    while True:
        now = datetime.now(timezone.utc)
        async with aiosqlite.connect(database.DB_PATH) as db:
            cursor = await db.execute("SELECT collector_id, tenant_id, last_seen_utc, health_state FROM collectors")
            rows = await cursor.fetchall()
            for col_id, tenant_id, last_seen_str, current_state in rows:
                last_seen = datetime.fromisoformat(last_seen_str.replace("Z", "+00:00"))
                gap_sec = (now - last_seen).total_seconds()
                if gap_sec > 60 and current_state != "Poor":
                    reason = f"Collector offline: no heartbeat for {int(gap_sec)}s (stale data downgraded)."
                    await db.execute(
                        "UPDATE collectors SET health_state = 'Poor', health_reason = ? WHERE collector_id = ?",
                        (reason, col_id)
                    )
                    await db.commit()
                    await manager.broadcast_to_tenant(tenant_id, {
                        "type": "collector_offline",
                        "collector_id": col_id,
                        "health_state": "Poor",
                        "health_reason": reason
                    })
        await asyncio.sleep(10)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.init_db()
    await auth.seed_demo_tenants()
    watchdog_task = asyncio.create_task(collector_heartbeat_watchdog())
    yield
    watchdog_task.cancel()

app = FastAPI(title="Aegis Tier 2 - Central AIOps SaaS Platform", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    company_name: str
    region: str = "in-south"

class ForgotRequest(BaseModel):
    username: str

class ResetRequest(BaseModel):
    username: str
    code: str
    new_password: str

@app.post("/api/v1/auth/login")
async def login(req: LoginRequest):
    result = await auth.authenticate_user(req.username, req.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return result

@app.post("/api/v1/auth/register")
async def register(req: RegisterRequest):
    return await auth.register_user(req.username, req.password, req.company_name, req.region)

@app.post("/api/v1/auth/forgot-password")
async def forgot_password(req: ForgotRequest):
    code = await auth.request_password_reset(req.username)
    return {"message": "Reset code generated", "demo_reset_code": code}

@app.post("/api/v1/auth/reset-password")
async def reset_password(req: ResetRequest):
    return await auth.reset_password(req.username, req.code, req.new_password)

@app.post("/api/v1/ingest")
async def ingest_metadata(event: dict, _=Depends(auth.verify_collector_token)):
    """Receives ONLY allow-listed metadata from Tier 1 collectors."""
    global DUPLICATES_BLOCKED
    now = datetime.now(timezone.utc)
    now_utc = now.isoformat()

    try:
        ev_time = datetime.fromisoformat(event["event_time_utc"].replace("Z", "+00:00"))
        latency_ms = max(1.0, round((now - ev_time).total_seconds() * 1000, 2))
    except Exception:
        latency_ms = 10.0

    is_new = await database.insert_telemetry_idempotent(event, now_utc, latency_ms)
    if not is_new:
        DUPLICATES_BLOCKED += 1
        return {"status": "duplicate_ignored", "payload_id": event["payload_id"]}

    health_state, health_reason = aiops.evaluate_health_state(event["metrics"], event["security_summary"])
    await database.upsert_collector_health(event, health_state, health_reason, now_utc)

    incident = await aiops.run_aiops_pipeline(event)

    await manager.broadcast_to_tenant(event["tenant_id"], {
        "type": "telemetry_update",
        "event": event,
        "ingest_latency_ms": latency_ms,
        "health_state": health_state,
        "health_reason": health_reason,
        "incident": incident
    })
    return {"status": "accepted", "payload_id": event["payload_id"], "ingest_latency_ms": latency_ms}

@app.get("/api/v1/dashboard")
async def get_dashboard(user: dict = Depends(auth.verify_user_token)):
    """Returns strictly tenant-isolated telemetry (sorted by event_time_utc), collectors, incidents, and SLA metrics."""
    tenant_id = user["tenant_id"]
    async with aiosqlite.connect(database.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        ev_cur = await db.execute(
            "SELECT * FROM telemetry_events WHERE tenant_id = ? ORDER BY event_time_utc DESC LIMIT 50",
            (tenant_id,)
        )
        events = [dict(r) for r in await ev_cur.fetchall()]

        col_cur = await db.execute("SELECT * FROM collectors WHERE tenant_id = ?", (tenant_id,))
        collectors = [dict(r) for r in await col_cur.fetchall()]

        inc_cur = await db.execute(
            "SELECT * FROM incidents WHERE tenant_id = ? ORDER BY updated_at_utc DESC LIMIT 20",
            (tenant_id,)
        )
        incidents = []
        for r in await inc_cur.fetchall():
            d = dict(r)
            d["contributing_signals"] = json.loads(d["contributing_signals"])
            incidents.append(d)

        rem_cur = await db.execute(
            "SELECT * FROM remediation_audit WHERE tenant_id = ? ORDER BY timestamp_utc DESC LIMIT 20",
            (tenant_id,)
        )
        remediations = [dict(r) for r in await rem_cur.fetchall()]

        latencies = [e["ingest_latency_ms"] for e in events]
        p95_latency = round(float(np.percentile(latencies, 95)), 2) if latencies else 0.0

    return {
        "tenant": user,
        "sla_proof": {
            "total_received": len(events),
            "duplicates_blocked": DUPLICATES_BLOCKED,
            "p95_ingest_latency_ms": p95_latency
        },
        "collectors": collectors,
        "events": list(reversed(events)),
        "incidents": incidents,
        "remediations": remediations
    }

@app.post("/api/v1/remediation/{action_id}/{decision}")
async def handle_remediation(action_id: str, decision: str, user: dict = Depends(auth.verify_user_token)):
    """Human-approved Autonomous Ops simulation with Rollback & Audit Trail."""
    if decision not in ("approve", "rollback"):
        raise HTTPException(status_code=400, detail="Decision must be 'approve' or 'rollback'")
    new_status = "EXECUTED_SIMULATED" if decision == "approve" else "ROLLED_BACK"
    now_utc = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(database.DB_PATH) as db:
        await db.execute(
            "UPDATE remediation_audit SET status = ?, approved_by = ?, timestamp_utc = ? WHERE action_id = ? AND tenant_id = ?",
            (new_status, user["sub"], now_utc, action_id, user["tenant_id"])
        )
        await db.commit()

    await manager.broadcast_to_tenant(user["tenant_id"], {
        "type": "remediation_update",
        "action_id": action_id,
        "status": new_status,
        "approved_by": user["sub"]
    })
    return {"action_id": action_id, "status": new_status, "approved_by": user["sub"]}

@app.websocket("/ws/{tenant_id}")
async def websocket_endpoint(websocket: WebSocket, tenant_id: str):
    await manager.connect(tenant_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(tenant_id, websocket)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run(app, host="0.0.0.0", port=port)