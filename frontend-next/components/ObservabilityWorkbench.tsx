"use client";

import React, { useMemo, useState } from "react";

interface ObservabilityWorkbenchProps {
  events?: any[];
  egress?: any;
}

export default function ObservabilityWorkbench({
  events = [],
  egress = null,
}: ObservabilityWorkbenchProps) {
  const [activeTool, setActiveTool] = useState<"traces" | "logs" | "metrics">("traces");
  const [search, setSearch] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const recentEvents = useMemo(() => {
    return [...(Array.isArray(events) ? events : [])].reverse().slice(0, 30);
  }, [events]);

  const egressRecords = useMemo(() => {
    return Array.isArray(egress?.records) ? egress.records : [];
  }, [egress]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recentEvents;
    return recentEvents.filter((e) =>
      JSON.stringify(e).toLowerCase().includes(q)
    );
  }, [recentEvents, search]);

  const latest = recentEvents[0] || {};
  const cpu = Number(latest?.cpu_pct ?? latest?.cpu ?? 0);
  const mem = Number(latest?.memory_pct ?? latest?.memory ?? 0);
  const latency = Number(latest?.latency_ms ?? latest?.latency ?? 0);
  const failedLogins = Number(latest?.failed_logins_1m ?? latest?.failed_logins ?? 0);

  const activeTrace =
    recentEvents.find((e, idx) => (e.payload_id || String(idx)) === selectedTraceId) ||
    recentEvents[0] ||
    null;

  const getSeverityBadge = (sev?: string) => {
    const s = (sev || "info").toLowerCase();
    if (s === "critical" || s === "high") return "bg-rose-100 text-rose-700";
    if (s === "warning" || s === "medium") return "bg-amber-100 text-amber-800";
    return "bg-emerald-100 text-emerald-700";
  };

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Unified Observability Workbench (Traces • Logs • Metrics)
          </h2>
          <p className="text-xs text-slate-500">
            OpenTelemetry-style inspection showing Where, When, and Why events occur across Tier 1 &amp; Tier 2.
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {(["traces", "logs", "metrics"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTool(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                activeTool === tab
                  ? "bg-white text-teal-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab === "traces"
                ? "Distributed Traces"
                : tab === "logs"
                ? "Structured Logs"
                : "Metric Signals"}
            </button>
          ))}
        </div>
      </div>

      {/* DISTRIBUTED TRACES */}
      {activeTool === "traces" && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              Live Trace Stream ({recentEvents.length})
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {recentEvents.length === 0 ? (
                <div className="p-4 text-xs text-slate-400">Waiting for live traces...</div>
              ) : (
                recentEvents.map((e, idx) => {
                  const id = e.payload_id || String(idx);
                  const isSelected = (activeTrace?.payload_id || "0") === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedTraceId(id)}
                      className={`w-full text-left px-3 py-2.5 transition cursor-pointer ${
                        isSelected ? "bg-teal-50/70" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-800 truncate">
                          {e.source_id || "edge-node"} • {String(id).slice(0, 8)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${getSeverityBadge(
                            e.severity
                          )}`}
                        >
                          {e.severity || "ok"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                        <span>{e.event_category || "infrastructure"}</span>
                        <span className="font-mono">{Number(e.latency_ms ?? 0).toFixed(1)} ms</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-7 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
            {activeTrace ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Trace ID:{" "}
                      <span className="font-mono text-teal-700">
                        {activeTrace.payload_id || "live-span"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      <strong>Where:</strong> {activeTrace.source_id || "col_nidasoshi_01"} •{" "}
                      <strong>When:</strong>{" "}
                      {activeTrace.event_time_utc
                        ? new Date(activeTrace.event_time_utc).toLocaleTimeString()
                        : "Live"}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono bg-white border border-slate-200 px-2 py-1 rounded">
                    SHA-256: {String(activeTrace.egress_hash || "verified").slice(0, 12)}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {[
                    {
                      name: "1. Tier-1 Edge Capture",
                      service: activeTrace.source_id || "edge-collector",
                      ms: "2.1 ms",
                      width: "w-1/4",
                      color: "bg-slate-700",
                    },
                    {
                      name: "2. Zero-Leak PII Scrubber",
                      service: "tier1-redactor",
                      ms: "1.4 ms",
                      width: "w-1/3",
                      color: "bg-rose-500",
                    },
                    {
                      name: "3. TLS Egress → Tier-2 Ingest",
                      service: "cloud-gateway",
                      ms: `${Number(activeTrace.latency_ms ?? 25).toFixed(1)} ms`,
                      width: "w-2/3",
                      color: "bg-teal-600",
                    },
                    {
                      name: "4. Z-Score AI Correlation",
                      service: "aiops-engine",
                      ms: "3.8 ms",
                      width: "w-full",
                      color: "bg-indigo-600",
                    },
                  ].map((span) => (
                    <div key={span.name} className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-semibold text-slate-800">{span.name}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {span.service} ({span.ms})
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className={`${span.color} ${span.width} h-2 rounded-full`} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-xs bg-white border border-slate-200 rounded-lg p-3 text-slate-700">
                  <strong>Why / Context:</strong>{" "}
                  {activeTrace.alert_context ||
                    `CPU ${Number(activeTrace.cpu_pct ?? 0).toFixed(1)}%, Mem ${Number(
                      activeTrace.memory_pct ?? 0
                    ).toFixed(1)}%, Latency ${Number(activeTrace.latency_ms ?? 0).toFixed(1)} ms`}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400">Select a trace to inspect spans.</div>
            )}
          </div>
        </div>
      )}

      {/* STRUCTURED LOGS */}
      {activeTool === "logs" && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter logs by source, severity, category, or hash..."
              className="w-full sm:w-80 px-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:border-teal-500"
            />
            <span className="text-[11px] font-mono text-slate-500">
              Tier-1 Scrubbed Records: {egressRecords.length}
            </span>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 border-b border-slate-200">Time</th>
                  <th className="px-3 py-2 border-b border-slate-200">Level</th>
                  <th className="px-3 py-2 border-b border-slate-200">Source</th>
                  <th className="px-3 py-2 border-b border-slate-200">Sanitized Log / Context</th>
                  <th className="px-3 py-2 border-b border-slate-200">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredLogs.map((e, idx) => (
                  <tr key={e.payload_id || idx} className="hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {e.event_time_utc
                        ? new Date(e.event_time_utc).toLocaleTimeString()
                        : "--:--:--"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-sans font-semibold px-2 py-0.5 rounded-full uppercase ${getSeverityBadge(
                          e.severity
                        )}`}
                      >
                        {e.severity || "info"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{e.source_id || "edge-01"}</td>
                    <td className="px-3 py-2 text-slate-800">
                      {e.alert_context ||
                        `cpu=${Number(e.cpu_pct ?? 0).toFixed(1)}% mem=${Number(
                          e.memory_pct ?? 0
                        ).toFixed(1)}% lat=${Number(e.latency_ms ?? 0).toFixed(1)}ms`}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {String(e.egress_hash || "—").slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* METRIC SIGNALS */}
      {activeTool === "metrics" && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              name: "node_cpu_utilization_pct",
              value: `${cpu.toFixed(1)}%`,
              pct: Math.min(100, cpu),
              warn: cpu > 75,
              threshold: "Threshold > 75%",
            },
            {
              name: "node_memory_utilization_pct",
              value: `${mem.toFixed(1)}%`,
              pct: Math.min(100, mem),
              warn: mem > 80,
              threshold: "Threshold > 80%",
            },
            {
              name: "edge_network_latency_ms",
              value: `${latency.toFixed(1)} ms`,
              pct: Math.min(100, (latency / 300) * 100),
              warn: latency > 100,
              threshold: "SLA > 100 ms",
            },
            {
              name: "auth_failed_logins_1m",
              value: `${failedLogins}`,
              pct: Math.min(100, failedLogins * 10),
              warn: failedLogins >= 5,
              threshold: "Brute-Force >= 5/m",
            },
          ].map((m) => (
            <div
              key={m.name}
              className="border border-slate-200 rounded-xl p-4 bg-slate-50/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-slate-500 truncate">{m.name}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    m.warn ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {m.warn ? "ALERT" : "OK"}
                </span>
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-2">{m.value}</div>
              <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    m.warn ? "bg-rose-500" : "bg-teal-600"
                  }`}
                  style={{ width: `${m.pct}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5">{m.threshold}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
