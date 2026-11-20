import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "central_saas.db")

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                company_name TEXT NOT NULL,
                region TEXT NOT NULL,
                role TEXT NOT NULL
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_events (
                payload_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                region TEXT NOT NULL,
                collector_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                event_time_utc TEXT NOT NULL,
                received_at_utc TEXT NOT NULL,
                ingest_latency_ms REAL NOT NULL,
                source_tz TEXT,
                event_category TEXT,
                severity TEXT,
                cpu_pct REAL,
                memory_pct REAL,
                disk_pct REAL,
                service_up INTEGER,
                bandwidth_mbps REAL,
                latency_ms REAL,
                packet_loss_pct REAL,
                connectivity INTEGER,
                failed_logins_1m INTEGER,
                suspicious_flag INTEGER,
                alert_context TEXT,
                egress_hash TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS collectors (
                collector_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                region TEXT NOT NULL,
                version TEXT,
                cpu_pct REAL,
                mem_pct REAL,
                config_status TEXT,
                health_state TEXT,
                health_reason TEXT,
                last_seen_utc TEXT NOT NULL
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                incident_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                collector_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                title TEXT NOT NULL,
                severity TEXT NOT NULL,
                status TEXT DEFAULT 'OPEN',
                correlated_count INTEGER DEFAULT 1,
                confidence_score REAL,
                contributing_signals TEXT,
                explanation TEXT,
                recommended_action TEXT,
                created_at_utc TEXT NOT NULL,
                updated_at_utc TEXT NOT NULL
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS remediation_audit (
                action_id TEXT PRIMARY KEY,
                incident_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                proposed_action TEXT NOT NULL,
                policy_check TEXT NOT NULL,
                status TEXT NOT NULL,
                approved_by TEXT,
                rollback_plan TEXT,
                timestamp_utc TEXT NOT NULL
            )
        """)
        await db.commit()

async def insert_telemetry_idempotent(event: dict, received_at_utc: str, latency_ms: float) -> bool:
    m = event["metrics"]
    sec = event["security_summary"]
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("""
            INSERT OR IGNORE INTO telemetry_events (
                payload_id, tenant_id, region, collector_id, source_id,
                event_time_utc, received_at_utc, ingest_latency_ms, source_tz,
                event_category, severity, cpu_pct, memory_pct, disk_pct,
                service_up, bandwidth_mbps, latency_ms, packet_loss_pct,
                connectivity, failed_logins_1m, suspicious_flag, alert_context, egress_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event["payload_id"], event["tenant_id"], event["region"],
            event["collector_id"], event["source_id"], event["event_time_utc"],
            received_at_utc, latency_ms, event.get("source_tz", "UTC"),
            event.get("event_category", "infrastructure"), event.get("severity", "info"),
            m["cpu_pct"], m["memory_pct"], m["disk_pct"], int(m["service_up"]),
            m["bandwidth_mbps"], m["latency_ms"], m["packet_loss_pct"],
            int(m["connectivity"]), sec["failed_logins_1m"], int(sec["suspicious_flag"]),
            event.get("alert_context", ""), event.get("egress_hash", "")
        ))
        await db.commit()
        return cursor.rowcount > 0

async def upsert_collector_health(event: dict, health_state: str, health_reason: str, now_utc: str):
    cm = event.get("collector_meta", {})
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO collectors (
                collector_id, tenant_id, region, version, cpu_pct, mem_pct,
                config_status, health_state, health_reason, last_seen_utc
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(collector_id) DO UPDATE SET
                version=excluded.version,
                cpu_pct=excluded.cpu_pct,
                mem_pct=excluded.mem_pct,
                config_status=excluded.config_status,
                health_state=excluded.health_state,
                health_reason=excluded.health_reason,
                last_seen_utc=excluded.last_seen_utc
        """, (
            event["collector_id"], event["tenant_id"], event["region"],
            cm.get("version", "1.0.0"), cm.get("cpu_pct", 0.0), cm.get("mem_pct", 0.0),
            cm.get("config_status", "valid"), health_state, health_reason, now_utc
        ))
        await db.commit()