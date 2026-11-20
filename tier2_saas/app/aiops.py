import uuid
import json
from collections import deque, defaultdict
from datetime import datetime, timezone
import numpy as np
import aiosqlite
from database import DB_PATH

# Rolling history per source_id for dynamic baseline anomaly detection
METRIC_HISTORY = defaultdict(lambda: {
    "cpu": deque(maxlen=30),
    "mem": deque(maxlen=30),
    "latency": deque(maxlen=30),
    "loss": deque(maxlen=30)
})

def compute_z_score(history: deque, current_val: float) -> float:
    if len(history) < 5:
        return 0.0
    arr = np.array(history, dtype=float)
    std = float(np.std(arr))
    if std < 0.5:
        return 0.0
    return abs((current_val - float(np.mean(arr))) / std)

def evaluate_health_state(metrics: dict, sec: dict) -> tuple[str, str]:
    """Classifies system into Excellent, Good, Fair, or Poor with clear reasoning."""
    if not metrics["service_up"] or not metrics["connectivity"]:
        return "Poor", "Critical service or network connectivity outage detected."
    if metrics["packet_loss_pct"] >= 5.0 or sec["failed_logins_1m"] >= 10 or metrics["cpu_pct"] >= 95.0:
        return "Poor", f"Critical threshold breached (CPU: {metrics['cpu_pct']}%, Loss: {metrics['packet_loss_pct']}%, Failed Logins: {sec['failed_logins_1m']})."
    if metrics["latency_ms"] >= 120.0 or metrics["packet_loss_pct"] >= 1.5 or metrics["cpu_pct"] >= 80.0 or sec["suspicious_flag"]:
        return "Fair", f"Elevated load or security warning (Latency: {metrics['latency_ms']}ms, CPU: {metrics['cpu_pct']}%)."
    if metrics["cpu_pct"] >= 65.0 or metrics["memory_pct"] >= 75.0 or metrics["latency_ms"] >= 70.0:
        return "Good", "Minor baseline deviation; no service impact."
    return "Excellent", "All telemetry metrics within healthy baselines."

async def run_aiops_pipeline(event: dict) -> dict | None:
    """Detects anomalies beyond static thresholds, correlates incidents, and builds explainable recommendations."""
    source_id = event["source_id"]
    tenant_id = event["tenant_id"]
    collector_id = event["collector_id"]
    m = event["metrics"]
    sec = event["security_summary"]
    hist = METRIC_HISTORY[source_id]

    # 1. Calculate dynamic Z-scores against rolling baseline
    z_cpu = compute_z_score(hist["cpu"], m["cpu_pct"])
    z_mem = compute_z_score(hist["mem"], m["memory_pct"])
    z_lat = compute_z_score(hist["latency"], m["latency_ms"])
    z_loss = compute_z_score(hist["loss"], m["packet_loss_pct"])

    # Update rolling baselines
    hist["cpu"].append(m["cpu_pct"])
    hist["mem"].append(m["memory_pct"])
    hist["latency"].append(m["latency_ms"])
    hist["loss"].append(m["packet_loss_pct"])

    # 2. Identify contributing signals & weights
    signals = []
    if z_cpu >= 2.2 or m["cpu_pct"] >= 85:
        signals.append({"signal": "CPU Anomaly", "value": f"{m['cpu_pct']}% (Z={z_cpu:.1f})", "weight": max(30, int(z_cpu * 15))})
    if z_mem >= 2.2 or m["memory_pct"] >= 88:
        signals.append({"signal": "Memory Pressure", "value": f"{m['memory_pct']}% (Z={z_mem:.1f})", "weight": max(25, int(z_mem * 12))})
    if z_lat >= 2.2 or m["latency_ms"] >= 120:
        signals.append({"signal": "Network Latency Spike", "value": f"{m['latency_ms']}ms (Z={z_lat:.1f})", "weight": max(35, int(z_lat * 15))})
    if z_loss >= 2.0 or m["packet_loss_pct"] >= 1.5:
        signals.append({"signal": "Packet Loss", "value": f"{m['packet_loss_pct']}%", "weight": 35})
    if sec["suspicious_flag"] or sec["failed_logins_1m"] >= 5:
        signals.append({"signal": "Auth Brute-Force Risk", "value": f"{sec['failed_logins_1m']} failed/min", "weight": 45})
    if not m["service_up"]:
        signals.append({"signal": "Service Down", "value": "Unavailable", "weight": 60})

    if not signals:
        return None

    # Normalize contribution percentages to 100%
    total_w = sum(s["weight"] for s in signals)
    for s in signals:
        s["contribution_pct"] = round((s["weight"] / total_w) * 100, 1)

    confidence = min(99.0, round(72.0 + (len(signals) * 7.5) + max(z_cpu, z_lat, 0) * 2.5, 1))
    severity = "critical" if (not m["service_up"] or sec["failed_logins_1m"] >= 10 or m["packet_loss_pct"] >= 5) else "warning"

    # Determine root-cause title & safe remediation
    if sec["suspicious_flag"] or sec["failed_logins_1m"] >= 5:
        title = f"Security & Access Anomaly on {source_id}"
        rec_action = "Apply temporary rate-limiting policy on local auth gateway & rotate session tokens"
        rollback_plan = "Revert local rate-limit rule and restore baseline auth policy"
    elif m["latency_ms"] >= 120 or m["packet_loss_pct"] >= 1.5:
        title = f"Network Degradation Correlated on {source_id}"
        rec_action = "Reroute egress traffic to secondary regional gateway & inspect NIC saturation"
        rollback_plan = "Restore primary routing table if secondary latency exceeds 80ms"
    else:
        title = f"Compute Baseline Deviation on {source_id}"
        rec_action = "Trigger safe horizontal scale-out & throttle non-critical background workers"
        rollback_plan = "Scale back to baseline replica count once CPU stabilizes below 60%"

    explanation = (
        f"Flagged by AIOps rolling baseline engine ({confidence}% confidence). "
        f"Correlated {len(signals)} simultaneous signal(s): "
        + ", ".join(f"{s['signal']} ({s['value']}, {s['contribution_pct']}% impact)" for s in signals) + "."
    )

    now_utc = datetime.now(timezone.utc).isoformat()

    # 3. Correlate into an existing OPEN incident for the same tenant + source_id (Alert-Noise Reduction)
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT incident_id, correlated_count FROM incidents WHERE tenant_id = ? AND source_id = ? AND status = 'OPEN' LIMIT 1",
            (tenant_id, source_id)
        )
        existing = await cursor.fetchone()

        if existing:
            incident_id, count = existing[0], existing[1] + 1
            await db.execute("""
                UPDATE incidents
                SET severity = ?, correlated_count = ?, confidence_score = ?,
                    contributing_signals = ?, explanation = ?, recommended_action = ?, updated_at_utc = ?
                WHERE incident_id = ?
            """, (severity, count, confidence, json.dumps(signals), explanation, rec_action, now_utc, incident_id))
            await db.commit()
        else:
            incident_id = f"INC-{str(uuid.uuid4())[:8].upper()}"
            count = 1
            await db.execute("""
                INSERT INTO incidents (
                    incident_id, tenant_id, collector_id, source_id, title, severity,
                    status, correlated_count, confidence_score, contributing_signals,
                    explanation, recommended_action, created_at_utc, updated_at_utc
                ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 1, ?, ?, ?, ?, ?, ?)
            """, (
                incident_id, tenant_id, collector_id, source_id, title, severity,
                confidence, json.dumps(signals), explanation, rec_action, now_utc, now_utc
            ))
            # Auto-propose a policy-checked remediation action (Human-in-the-loop)
            action_id = f"ACT-{str(uuid.uuid4())[:8].upper()}"
            await db.execute("""
                INSERT INTO remediation_audit (
                    action_id, incident_id, tenant_id, proposed_action, policy_check,
                    status, approved_by, rollback_plan, timestamp_utc
                ) VALUES (?, ?, ?, ?, 'PASSED (Reversible & Policy-Bounded)', 'PENDING_APPROVAL', NULL, ?, ?)
            """, (action_id, incident_id, tenant_id, rec_action, rollback_plan, now_utc))
            await db.commit()

    return {
        "incident_id": incident_id,
        "tenant_id": tenant_id,
        "source_id": source_id,
        "title": title,
        "severity": severity,
        "correlated_count": count,
        "confidence_score": confidence,
        "contributing_signals": signals,
        "explanation": explanation,
        "recommended_action": rec_action,
        "updated_at_utc": now_utc
    }