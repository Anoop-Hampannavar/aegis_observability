import asyncio
import json
import os
import random
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn

import database
import scrubber

SAAS_INGEST_URL = os.getenv(""https://aegis-tier2-saas-da03.onrender.com/api/v1/ingest"", "http://127.0.0.1:8002/api/v1/ingest")
COLLECTOR_TOKEN = os.getenv("COLLECTOR_TOKEN", "aegis-secret-collector-token-2026")
TENANT_ID = os.getenv("TENANT_ID", "tenant_fincorp_in")
REGION = os.getenv("REGION", "in-south")
COLLECTOR_ID = os.getenv("COLLECTOR_ID", "col_nidasoshi_01")

SIMULATE_OUTAGE = False
AUTO_STREAM = True

async def egress_sender_worker():
    """Flushes pending metadata from local SQLite to Tier 2 SaaS with zero loss."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            if not SIMULATE_OUTAGE:
                pending = await database.get_pending_payloads(limit=50)
                for payload_id, payload_json in pending:
                    try:
                        resp = await client.post(
                            SAAS_INGEST_URL,
                            content=payload_json,
                            headers={
                                "Content-Type": "application/json",
                                "Authorization": f"Bearer {COLLECTOR_TOKEN}"
                            }
                        )
                        if resp.status_code in (200, 201):
                            await database.mark_as_sent(payload_id, datetime.now(timezone.utc).isoformat())
                    except Exception:
                        break
            await asyncio.sleep(1.0)

async def live_telemetry_generator():
    """Generates realistic baseline telemetry every 3 seconds (can be replaced by organizer stream)."""
    while True:
        if AUTO_STREAM:
            raw_event = {
                "hostname": "prod-fin-core-01.internal",
                "event_category": "infrastructure",
                "raw_log": f"INFO healthcheck ok user=svc_monitor ip=10.0.4.22",
                "metrics": {
                    "cpu_pct": round(random.uniform(32.0, 48.0), 1),
                    "memory_pct": round(random.uniform(45.0, 58.0), 1),
                    "disk_pct": 54.2,
                    "service_up": True,
                    "bandwidth_mbps": round(random.uniform(180.0, 240.0), 1),
                    "latency_ms": round(random.uniform(22.0, 38.0), 1),
                    "packet_loss_pct": round(random.uniform(0.0, 0.2), 2),
                    "connectivity": True
                },
                "failed_logins_1m": random.choice([0, 0, 0, 1])
            }
            await process_raw_event(raw_event)
        await asyncio.sleep(3.0)

async def process_raw_event(raw_event: dict):
    now_utc = datetime.now(timezone.utc).isoformat()
    clean_payload, secrets_found, egress_hash = scrubber.build_allowlisted_payload(
        raw_event, TENANT_ID, REGION, COLLECTOR_ID
    )
    await database.save_local_and_queue(
        payload_id=clean_payload["payload_id"],
        raw_content=json.dumps(raw_event),
        secrets_detected=", ".join(secrets_found) if secrets_found else "None",
        payload_json=json.dumps(clean_payload),
        egress_hash=egress_hash,
        now_utc=now_utc
    )
    return clean_payload, secrets_found

@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.init_db()
    t1 = asyncio.create_task(egress_sender_worker())
    t2 = asyncio.create_task(live_telemetry_generator())
    yield
    t1.cancel()
    t2.cancel()

app = FastAPI(title="Aegis Tier 1 - Local Collector", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/local/ingest")
async def ingest_raw_telemetry(raw_event: dict):
    clean_payload, secrets_found = await process_raw_event(raw_event)
    return {"status": "processed_locally", "payload_id": clean_payload["payload_id"], "secrets_blocked": secrets_found}

@app.post("/api/local/simulate/{scenario}")
async def simulate_judge_scenario(scenario: str):
    """One-click Chaos Control for Judges: secret_leak, brute_force, latency_spike, cpu_anomaly, out_of_order."""
    now = datetime.now(timezone.utc)
    if scenario == "secret_leak":
        ev = {
            "hostname": "prod-auth-01.internal",
            "raw_log": "ERROR db_connect failed password=SuperSecretProd99! api_key=AKIAIOSFODNN7EXAMPLE admin@fincorp.in 192.168.1.50",
            "metrics": {"cpu_pct": 42.0, "memory_pct": 51.0, "disk_pct": 54.0, "service_up": True, "bandwidth_mbps": 210.0, "latency_ms": 30.0, "packet_loss_pct": 0.1, "connectivity": True},
            "failed_logins_1m": 0
        }
    elif scenario == "brute_force":
        ev = {
            "hostname": "prod-auth-01.internal",
            "event_category": "security",
            "raw_log": "WARN sshd failed login for root password=admin123 from 10.22.1.9 (18 attempts/min)",
            "metrics": {"cpu_pct": 55.0, "memory_pct": 60.0, "disk_pct": 54.0, "service_up": True, "bandwidth_mbps": 290.0, "latency_ms": 48.0, "packet_loss_pct": 0.2, "connectivity": True},
            "failed_logins_1m": 18
        }
    elif scenario == "latency_spike":
        ev = {
            "hostname": "prod-fin-core-01.internal",
            "event_category": "network",
            "raw_log": "CRITICAL gateway eth0 congestion latency=245ms packet_loss=6.4%",
            "metrics": {"cpu_pct": 68.0, "memory_pct": 64.0, "disk_pct": 54.0, "service_up": True, "bandwidth_mbps": 910.0, "latency_ms": 245.0, "packet_loss_pct": 6.4, "connectivity": True},
            "failed_logins_1m": 0
        }
    elif scenario == "cpu_anomaly":
        ev = {
            "hostname": "prod-fin-core-01.internal",
            "event_category": "infrastructure",
            "raw_log": "ALERT worker pool saturated cpu=96.4% mem=91.2%",
            "metrics": {"cpu_pct": 96.4, "memory_pct": 91.2, "disk_pct": 54.0, "service_up": True, "bandwidth_mbps": 350.0, "latency_ms": 140.0, "packet_loss_pct": 2.1, "connectivity": True},
            "failed_logins_1m": 0
        }
    elif scenario == "out_of_order":
        ev = {
            "hostname": "prod-fin-core-01.internal",
            "event_time_utc": (now - timedelta(minutes=2)).isoformat(),
            "raw_log": "INFO delayed telemetry packet arrived 2 minutes late",
            "metrics": {"cpu_pct": 44.0, "memory_pct": 52.0, "disk_pct": 54.0, "service_up": True, "bandwidth_mbps": 200.0, "latency_ms": 29.0, "packet_loss_pct": 0.0, "connectivity": True},
            "failed_logins_1m": 0
        }
    else:
        return {"error": "Unknown scenario"}
    clean_payload, secrets_found = await process_raw_event(ev)
    return {"scenario": scenario, "payload_id": clean_payload["payload_id"], "secrets_blocked": secrets_found}

@app.get("/api/local/egress-proof")
async def egress_proof_panel(limit: int = 20):
    rows, stats = await database.get_egress_proof(limit)
    records = [{
        "payload_id": r[0],
        "raw_local_only": json.loads(r[1]),
        "secrets_redacted": r[2],
        "egress_metadata_sent": json.loads(r[3]),
        "egress_hash": r[4],
        "delivery_status": r[5],
        "created_at_utc": r[6],
        "sent_at_utc": r[7]
    } for r in rows]
    return {
        "collector_id": COLLECTOR_ID,
        "tenant_id": TENANT_ID,
        "region": REGION,
        "outage_mode": SIMULATE_OUTAGE,
        "stats": {"total_generated": stats[0] or 0, "total_sent": stats[1] or 0, "currently_buffered": stats[2] or 0},
        "records": records
    }

@app.post("/api/local/toggle-outage")
async def toggle_outage():
    global SIMULATE_OUTAGE
    SIMULATE_OUTAGE = not SIMULATE_OUTAGE
    return {"outage_mode": SIMULATE_OUTAGE}
@app.post("/api/local/bind-tenant")
async def bind_tenant(payload: dict):
    """Dynamically binds this Tier 1 collector to any newly registered tenant account."""
    global TENANT_ID, REGION
    TENANT_ID = payload.get("tenant_id", TENANT_ID)
    REGION = payload.get("region", REGION)
    return {"status": "bound", "tenant_id": TENANT_ID, "region": REGION}
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
