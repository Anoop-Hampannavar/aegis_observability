import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "local_collector.db")

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS raw_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload_id TEXT UNIQUE,
                raw_content TEXT,
                secrets_detected TEXT,
                received_at_utc TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS egress_queue (
                payload_id TEXT PRIMARY KEY,
                payload_json TEXT,
                egress_hash TEXT,
                status TEXT DEFAULT 'PENDING',
                created_at_utc TEXT,
                sent_at_utc TEXT
            )
        """)
        await db.commit()

async def save_local_and_queue(payload_id: str, raw_content: str, secrets_detected: str, payload_json: str, egress_hash: str, now_utc: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO raw_logs (payload_id, raw_content, secrets_detected, received_at_utc) VALUES (?, ?, ?, ?)",
            (payload_id, raw_content, secrets_detected, now_utc)
        )
        await db.execute(
            "INSERT OR IGNORE INTO egress_queue (payload_id, payload_json, egress_hash, status, created_at_utc) VALUES (?, ?, ?, 'PENDING', ?)",
            (payload_id, payload_json, egress_hash, now_utc)
        )
        await db.commit()

async def get_pending_payloads(limit: int = 50):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT payload_id, payload_json FROM egress_queue WHERE status = 'PENDING' ORDER BY created_at_utc ASC LIMIT ?",
            (limit,)
        )
        return await cursor.fetchall()

async def mark_as_sent(payload_id: str, sent_at_utc: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE egress_queue SET status = 'SENT', sent_at_utc = ? WHERE payload_id = ?",
            (sent_at_utc, payload_id)
        )
        await db.commit()

async def get_egress_proof(limit: int = 20):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("""
            SELECT r.payload_id, r.raw_content, r.secrets_detected, e.payload_json, e.egress_hash, e.status, e.created_at_utc, e.sent_at_utc
            FROM raw_logs r
            JOIN egress_queue e ON r.payload_id = e.payload_id
            ORDER BY r.id DESC
            LIMIT ?
        """, (limit,))
        rows = await cursor.fetchall()

        stats_cursor = await db.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as buffered
            FROM egress_queue
        """)
        stats = await stats_cursor.fetchone()
        return rows, stats