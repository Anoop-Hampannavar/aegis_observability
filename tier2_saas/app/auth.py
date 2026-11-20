import jwt
import hashlib
import random
import re
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, Header
import aiosqlite
from database import DB_PATH

JWT_SECRET = "aegis-enterprise-2026-super-secret-key"
JWT_ALGORITHM = "HS256"
COLLECTOR_API_KEY = "aegis-secret-collector-token-2026"

RESET_CODES = {}

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def create_jwt(username: str, tenant_id: str, company_name: str, region: str, role: str) -> dict:
    payload = {
        "sub": username,
        "tenant_id": tenant_id,
        "company_name": company_name,
        "region": region,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=24)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {
        "access_token": token,
        "user": {
            "username": username,
            "tenant_id": tenant_id,
            "company_name": company_name,
            "region": region,
            "role": role
        }
    }

async def seed_demo_tenants():
    demo_users = [
        ("admin@fincorp.in", hash_password("fincorp123"), "tenant_fincorp_in", "FinCorp India", "in-south", "SRE Admin"),
        ("admin@medtech.eu", hash_password("medtech123"), "tenant_medtech_eu", "MedTech Europe", "eu-west", "Security Lead")
    ]
    async with aiosqlite.connect(DB_PATH) as db:
        for u in demo_users:
            await db.execute(
                "INSERT OR IGNORE INTO users (username, password_hash, tenant_id, company_name, region, role) VALUES (?, ?, ?, ?, ?, ?)",
                u
            )
        await db.commit()

async def register_user(username: str, password: str, company_name: str, region: str):
    slug = re.sub(r"[^a-z0-9]+", "_", company_name.lower()).strip("_") or "org"
    tenant_id = f"tenant_{slug}_{random.randint(100, 999)}"
    role = "Org Admin"
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT username FROM users WHERE username = ?", (username,))
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="An account with this email already exists.")
        await db.execute(
            "INSERT INTO users (username, password_hash, tenant_id, company_name, region, role) VALUES (?, ?, ?, ?, ?, ?)",
            (username, hash_password(password), tenant_id, company_name, region, role)
        )
        await db.commit()
    return create_jwt(username, tenant_id, company_name, region, role)

async def authenticate_user(username: str, password: str):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT username, password_hash, tenant_id, company_name, region, role FROM users WHERE username = ?",
            (username,)
        )
        row = await cursor.fetchone()
        if not row or row[1] != hash_password(password):
            return None
        return create_jwt(row[0], row[2], row[3], row[4], row[5])

async def request_password_reset(username: str) -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT username FROM users WHERE username = ?", (username,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="No account found with this email.")
    code = str(random.randint(100000, 999999))
    RESET_CODES[username] = {"code": code, "exp": datetime.now(timezone.utc) + timedelta(minutes=10)}
    return code

async def reset_password(username: str, code: str, new_password: str):
    record = RESET_CODES.get(username)
    if not record or record["code"] != code or datetime.now(timezone.utc) > record["exp"]:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code.")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (hash_password(new_password), username)
        )
        await db.commit()
    del RESET_CODES[username]
    return {"status": "password_updated"}

def verify_user_token(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Bearer token")
    token = authorization.split(" ")[1]
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def verify_collector_token(authorization: str = Header(None)):
    if authorization != f"Bearer {COLLECTOR_API_KEY}":
        raise HTTPException(status_code=403, detail="Unauthorized collector credential")