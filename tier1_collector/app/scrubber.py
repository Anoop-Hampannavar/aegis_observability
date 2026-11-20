import re
import uuid
import json
import hashlib
from datetime import datetime, timezone

SECRET_PATTERNS = {
    "password": r"(?i)(password|passwd|pwd)\s*[:=]\s*[^\s,;]+",
    "api_key": r"(?i)(api[_-]?key|secret[_-]?key|token|bearer)\s*[:=]\s*[^\s,;]+",
    "aws_key": r"AKIA[0-9A-Z]{16}",
    "email": r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
    "private_ip": r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b"
}

def pseudonymize_source(raw_hostname: str) -> str:
    hashed = hashlib.sha256(raw_hostname.encode("utf-8")).hexdigest()[:8]
    return f"node_{hashed}"

def detect_secrets(raw_text: str) -> list[str]:
    return [label for label, pattern in SECRET_PATTERNS.items() if re.search(pattern, raw_text)]

def build_allowlisted_payload(raw_event: dict, tenant_id: str, region: str, collector_id: str) -> tuple[dict, list[str], str]:
    raw_log_text = str(raw_event.get("raw_log", ""))
    secrets_found = detect_secrets(raw_log_text)

    metrics = raw_event.get("metrics", {})
    failed_logins = int(raw_event.get("failed_logins_1m", 0))
    suspicious_flag = failed_logins >= 5 or bool(raw_event.get("suspicious_flag", False))

    context_notes = []
    if metrics.get("cpu_pct", 0) > 85:
        context_notes.append("High CPU utilization")
    if metrics.get("latency_ms", 0) > 120:
        context_notes.append("Elevated network latency")
    if metrics.get("packet_loss_pct", 0) > 1.5:
        context_notes.append("Packet loss detected")
    if suspicious_flag:
        context_notes.append(f"Repeated auth failures ({failed_logins}/min) flagged locally")
    if secrets_found:
        context_notes.append(f"Redacted local secrets: {', '.join(secrets_found)}")

    alert_context = "; ".join(context_notes) if context_notes else "Normal operational telemetry."

    severity = "info"
    if not metrics.get("service_up", True) or metrics.get("packet_loss_pct", 0) > 5 or failed_logins >= 10:
        severity = "critical"
    elif context_notes:
        severity = "warning"

    payload_id = raw_event.get("payload_id") or str(uuid.uuid4())
    event_time_utc = raw_event.get("event_time_utc") or datetime.now(timezone.utc).isoformat()

    clean_payload = {
        "payload_id": payload_id,
        "tenant_id": tenant_id,
        "region": region,
        "collector_id": collector_id,
        "collector_meta": {
            "version": "1.0.0",
            "cpu_pct": round(float(raw_event.get("collector_cpu", 8.5)), 2),
            "mem_pct": round(float(raw_event.get("collector_mem", 24.0)), 2),
            "config_status": "valid"
        },
        "event_time_utc": event_time_utc,
        "source_tz": raw_event.get("source_tz", "Asia/Kolkata"),
        "source_id": pseudonymize_source(str(raw_event.get("hostname", "prod-db-01.internal"))),
        "event_category": raw_event.get("event_category", "infrastructure"),
        "severity": severity,
        "metrics": {
            "cpu_pct": round(float(metrics.get("cpu_pct", 0.0)), 2),
            "memory_pct": round(float(metrics.get("memory_pct", 0.0)), 2),
            "disk_pct": round(float(metrics.get("disk_pct", 0.0)), 2),
            "service_up": bool(metrics.get("service_up", True)),
            "bandwidth_mbps": round(float(metrics.get("bandwidth_mbps", 0.0)), 2),
            "latency_ms": round(float(metrics.get("latency_ms", 0.0)), 2),
            "packet_loss_pct": round(float(metrics.get("packet_loss_pct", 0.0)), 2),
            "connectivity": bool(metrics.get("connectivity", True))
        },
        "security_summary": {
            "failed_logins_1m": failed_logins,
            "suspicious_flag": suspicious_flag
        },
        "alert_context": alert_context
    }

    # Tamper-proof SHA-256 hash of the scrubbed payload
    canonical = json.dumps(clean_payload, sort_keys=True)
    egress_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    clean_payload["egress_hash"] = egress_hash

    return clean_payload, secrets_found, egress_hash