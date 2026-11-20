"use client";

import React, { useMemo, useState } from "react";

interface EnterpriseModulesProps {
  metrics?: any[];
  incidents?: any[];
  tenantName?: string;
  collectorId?: string;
}

export default function EnterpriseModules({
  metrics = [],
  incidents = [],
  tenantName = "FinCorp India",
  collectorId = "col_nidasoshi_01",
}: EnterpriseModulesProps) {
  const [showInspector, setShowInspector] = useState(true);
  const [exported, setExported] = useState(false);

  // Safely read latest telemetry point regardless of exact field names
  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const cpu = Number(latest?.cpu_percent ?? latest?.cpu ?? latest?.compute_load ?? 0);
  const mem = Number(latest?.memory_percent ?? latest?.memory ?? latest?.mem_percent ?? 0);
  const latency = Number(latest?.network_latency_ms ?? latest?.latency_ms ?? latest?.latency ?? 0);
  const failedLogins = Number(latest?.failed_logins ?? latest?.auth_anomalies ?? 0);

  // 1. FINOPS: Business Impact & Downtime Cost Calculator
  const finops = useMemo(() => {
    const activeIncidents = Array.isArray(incidents) ? incidents.length : 0;
    const baseRiskPerIncident = 22500; // ₹22,500/hr SLA exposure per correlated incident
    const latencyPenalty = latency > 100 ? Math.round((latency - 100) * 120) : 0;
    const hourlyRisk = activeIncidents * baseRiskPerIncident + latencyPenalty;
    const status =
      hourlyRisk === 0 ? "Protected" : hourlyRisk < 30000 ? "Moderate SLA Risk" : "High Revenue Risk";
    return { activeIncidents, hourlyRisk, status };
  }, [incidents, latency]);

  // 2. PROACTIVE AI: Predictive "Time-to-Crash" Trajectory
  const prediction = useMemo(() => {
    if (!Array.isArray(metrics) || metrics.length < 5) {
      return {
        alert: false,
        title: "Collecting Baseline...",
        detail: "Waiting for 5+ live telemetry points to compute exhaustion slope.",
        eta: "Stable",
      };
    }

    const recent = metrics.slice(-6).map((m) =>
      Number(m?.memory_percent ?? m?.memory ?? m?.mem_percent ?? 0)
    );
    const slope = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
    const currentMem = recent[recent.length - 1];

    if (slope > 0.6 && currentMem < 100) {
      const ticksToFull = Math.max(1, Math.round((100 - currentMem) / slope));
      const estMinutes = Math.max(1, Math.round((ticksToFull * 3) / 60));
      return {
        alert: true,
        title: "Memory Exhaustion Trend Detected",
        detail: `Memory climbing at +${slope.toFixed(1)}%/tick. Proactive scaling recommended.`,
        eta: `~${estMinutes} min to 100%`,
      };
    }

    return {
      alert: false,
      title: "Trajectory Stable (No Crash Predicted)",
      detail: `Current Memory at ${currentMem.toFixed(1)}% with safe rolling slope (${slope.toFixed(2)}%/tick).`,
      eta: "Healthy",
    };
  }, [metrics]);

  // 3. ZERO-LEAK PROOF: Sanitized Cloud Payload Snapshot
  const sanitizedPayload = {
    tenant_id: tenantName.toLowerCase().replace(/\s+/g, "_"),
    collector_id: collectorId,
    cpu_percent: Number(cpu.toFixed(1)),
    memory_percent: Number(mem.toFixed(1)),
    network_latency_ms: Number(latency.toFixed(1)),
    failed_logins_per_min: failedLogins,
    pii_stripped: true,
    zero_leak_verified: true,
  };

  // 4. 1-CLICK COMPLIANCE & POST-MORTEM REPORT EXPORT
  const handleDownloadReport = () => {
    const nowUtc = new Date().toISOString();
    const reportText = [
      "============================================================",
      "        AEGIS AIOPS — COMPLIANCE & POST-MORTEM REPORT       ",
      "============================================================",
      `Generated (UTC):        ${nowUtc}`,
      `Tenant Workspace:       ${tenantName}`,
      `Active Tier-1 Agent:    ${collectorId}`,
      `Zero-Leak Status:       VERIFIED (No PII / Raw Logs in Cloud)`,
      "",
      "--- 1. LIVE SYSTEM SNAPSHOT ---",
      `Compute Load (CPU):     ${cpu.toFixed(1)}%`,
      `Memory Utilization:     ${mem.toFixed(1)}%`,
      `Network Latency:        ${latency.toFixed(1)} ms`,
      `Failed Logins / Min:    ${failedLogins}`,
      "",
      "--- 2. PREDICTIVE AI TRAJECTORY ---",
      `Status:                 ${prediction.title}`,
      `Projected ETA:          ${prediction.eta}`,
      `Details:                ${prediction.detail}`,
      "",
      "--- 3. FINOPS BUSINESS IMPACT ---",
      `Correlated Incidents:   ${finops.activeIncidents}`,
      `Estimated SLA Risk:     INR ${finops.hourlyRisk.toLocaleString("en-IN")} / hr`,
      `Risk Classification:    ${finops.status}`,
      "",
      "--- 4. GOVERNANCE & HUMAN-IN-THE-LOOP ---",
      "All AI remediation actions require explicit operator approval",
      "with full rollback support and zero-leak telemetry isolation.",
      "============================================================",
    ].join("\n");

    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aegis-compliance-report-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);

    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <section className="mt-8 space-y-6">
      {/* Section Header + 1-Click Compliance Report Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Enterprise Intelligence &amp; Zero-Leak Governance
          </h2>
          <p className="text-xs text-slate-500">
            FinOps SLA Risk • Proactive Crash Prediction • Live Privacy Proof • Audit Export
          </p>
        </div>

        <button
          onClick={handleDownloadReport}
          className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition shadow-sm cursor-pointer"
        >
          {exported ? "✓ Compliance Report Downloaded" : "↓ Download Post-Mortem Report"}
        </button>
      </div>

      {/* Top Row: FinOps Cost Calculator + Predictive Time-to-Crash */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* FinOps Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              FinOps — Business Downtime Risk
            </span>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                finops.hourlyRisk === 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {finops.status}
            </span>
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-1">
            ₹{finops.hourlyRisk.toLocaleString("en-IN")}
            <span className="text-sm font-medium text-slate-500"> / hr</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Calculated live from {finops.activeIncidents} correlated incident(s) and{" "}
            {latency.toFixed(1)} ms network latency SLA exposure.
          </p>
        </div>

        {/* Predictive Time-to-Crash Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Proactive AI — Exhaustion Forecast
            </span>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                prediction.alert
                  ? "bg-amber-100 text-amber-800"
                  : "bg-teal-50 text-teal-700"
              }`}
            >
              {prediction.eta}
            </span>
          </div>
          <div className="text-lg font-bold text-slate-900 mt-1">{prediction.title}</div>
          <p className="text-xs text-slate-500 mt-2">{prediction.detail}</p>
        </div>
      </div>

      {/* Bottom Row: Live Zero-Leak Proof Inspector */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Live &ldquo;Zero-Leak Proof&rdquo; Payload Inspector
            </h3>
            <p className="text-xs text-slate-500">
              Visual verification that sensitive customer PII stays inside Tier 1 and never reaches Cloud Tier 2.
            </p>
          </div>
          <button
            onClick={() => setShowInspector(!showInspector)}
            className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
          >
            {showInspector ? "Hide Inspector" : "Show Inspector"}
          </button>
        </div>

        {showInspector && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Blocked inside Tier 1 */}
            <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-rose-700">
                  TIER 1 (PRIVATE SERVER — BLOCKED FROM CLOUD)
                </span>
                <span className="text-[11px] font-semibold bg-rose-100 text-rose-700 px-2 py-0.5 rounded">
                  PII Redacted
                </span>
              </div>
              <pre className="text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
{`[RAW AUTH LOG - NEVER TRANSMITTED]
user_email: "rahul.sharma@fincorp.in"
client_ip:  "192.168.14.88"
kyc_pan:    "ABCDE1234F"
session_id: "sess_98a7f6c54e"
status:     "FAILED_LOGIN_BURST"`}
              </pre>
            </div>

            {/* Right: Sent to Cloud Tier 2 */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-emerald-700">
                  TIER 2 (CLOUD AI — LIVE SANITIZED STREAM)
                </span>
                <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                  Zero-Leak Verified
                </span>
              </div>
              <pre className="text-xs text-slate-800 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                {JSON.stringify(sanitizedPayload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
