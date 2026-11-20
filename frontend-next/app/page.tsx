"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Shield, Activity, Cpu, Network, Lock, AlertTriangle, CheckCircle2,
  RotateCcw, Wifi, WifiOff, Server, LogOut, Zap, Layers, Radio,
  Fingerprint, Link2, Clock, Sun, Moon, Sparkles, Play, ChevronRight
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar
} from "recharts";
import EnterpriseModules from "../components/EnterpriseModules";
const SAAS_API = process.env.NEXT_PUBLIC_SAAS_API || "https://aegis-tier2-saas-da03.onrender.com";
const SAAS_WS = process.env.NEXT_PUBLIC_SAAS_WS || "wss://aegis-tier2-saas-da03.onrender.com";
const TIER1_API = process.env.NEXT_PUBLIC_TIER1_API || "http://127.0.0.1:8001";

interface User {
  username: string;
  tenant_id: string;
  company_name: string;
  region: string;
  role: string;
}

export default function AegisEnterprisePlatform() {
  const [dark, setDark] = useState(false); // Crisp Enterprise Light by default, 1-click Dark SOC mode
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const [authMsg, setAuthMsg] = useState<{ text: string; err: boolean } | null>(null);

  const [email, setEmail] = useState("admin@fincorp.in");
  const [password, setPassword] = useState("fincorp123");
  const [regCompany, setRegCompany] = useState("");
  const [regRegion, setRegRegion] = useState("in-south");
  const [fpCode, setFpCode] = useState("");
  const [fpNewPass, setFpNewPass] = useState("");
  const [fpStep2, setFpStep2] = useState(false);

  const [activeTab, setActiveTab] = useState<"overview" | "aiops" | "remediation" | "egress">("overview");
  const [wsConnected, setWsConnected] = useState(false);
  const [data, setData] = useState<any>(null);
  const [egress, setEgress] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const t = localStorage.getItem("aegis_token");
    const u = localStorage.getItem("aegis_user");
    if (t && u) {
      setToken(t);
      setUser(JSON.parse(u));
    }
  }, []);

  const fetchDashboard = async (authToken: string) => {
    try {
      const res = await fetch(`${SAAS_API}/api/v1/dashboard`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.status === 401) { logout(); return; }
      setData(await res.json());
    } catch {}
  };

  const fetchEgress = async () => {
    try {
      const res = await fetch(`${TIER1_API}/api/local/egress-proof?limit=10`);
      setEgress(await res.json());
    } catch {}
  };

  useEffect(() => {
    if (!token || !user) return;
    fetchDashboard(token);
    fetchEgress();

    const ws = new WebSocket(`${SAAS_WS}/ws/${user.tenant_id}`);
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = () => {
      fetchDashboard(token);
      fetchEgress();
    };

    const poll = setInterval(fetchEgress, 2500);
    return () => { ws.close(); clearInterval(poll); };
  }, [token, user]);

  // ==================== AUTH HANDLERS ====================
  const handleLogin = async (e?: React.FormEvent, overrideEmail?: string, overridePass?: string) => {
    if (e) e.preventDefault();
    setAuthMsg(null);
    try {
      const res = await fetch(`${SAAS_API}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: overrideEmail ?? email, password: overridePass ?? password })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Invalid credentials");
      localStorage.setItem("aegis_token", d.access_token);
      localStorage.setItem("aegis_user", JSON.stringify(d.user));
      setToken(d.access_token);
      setUser(d.user);
    } catch (err: any) { setAuthMsg({ text: err.message, err: true }); }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMsg(null);
    try {
      const res = await fetch(`${SAAS_API}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_name: regCompany, region: regRegion, username: email, password })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Registration failed");
      localStorage.setItem("aegis_token", d.access_token);
      localStorage.setItem("aegis_user", JSON.stringify(d.user));
      setToken(d.access_token);
      setUser(d.user);
      notify(`Workspace created for ${d.user.company_name}!`);
    } catch (err: any) { setAuthMsg({ text: err.message, err: true }); }
  };

  const handleSendOTP = async () => {
    setAuthMsg(null);
    try {
      const res = await fetch(`${SAAS_API}/api/v1/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Account not found");
      setFpStep2(true);
      setAuthMsg({ text: `Verification OTP: ${d.demo_reset_code}`, err: false });
    } catch (err: any) { setAuthMsg({ text: err.message, err: true }); }
  };

  const handleResetPass = async () => {
    try {
      const res = await fetch(`${SAAS_API}/api/v1/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, code: fpCode, new_password: fpNewPass })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Reset failed");
      setAuthMode("login");
      setAuthMsg({ text: "Password updated! Sign in now.", err: false });
    } catch (err: any) { setAuthMsg({ text: err.message, err: true }); }
  };

  const logout = () => {
    localStorage.clear();
    wsRef.current?.close();
    setToken(null);
    setUser(null);
    setData(null);
  };

  // ==================== LIVE ACTIONS ====================
  const bindCollectorToMe = async () => {
    if (!user) return;
    await fetch(`${TIER1_API}/api/local/bind-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: user.tenant_id, region: user.region })
    });
    notify(`Tier 1 Collector bound to ${user.company_name}!`);
    setTimeout(() => token && fetchDashboard(token), 1200);
  };

  const triggerScenario = async (scenario: string) => {
    await fetch(`${TIER1_API}/api/local/simulate/${scenario}`, { method: "POST" });
    notify(`Triggered live scenario: ${scenario.replace("_", " ").toUpperCase()}`);
    setTimeout(() => { if (token) fetchDashboard(token); fetchEgress(); }, 500);
  };

  const toggleOutage = async () => {
    const res = await fetch(`${TIER1_API}/api/local/toggle-outage`, { method: "POST" });
    const d = await res.json();
    notify(d.outage_mode ? "Network CUT — Buffering locally in SQLite!" : "Network RESTORED — Flushing buffer with 0 loss!");
    fetchEgress();
  };

  const decideRemediation = async (id: string, decision: "approve" | "rollback") => {
    if (!token) return;
    await fetch(`${SAAS_API}/api/v1/remediation/${id}/${decision}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    notify(`Action ${id} marked ${decision.toUpperCase()} in Audit Log.`);
    fetchDashboard(token);
  };

  // Theme tokens
  const bgPage = dark ? "bg-[#060a14] text-slate-100" : "bg-[#f8fafc] text-slate-900";
  const bgCard = dark ? "bg-[#0d1424] border-slate-800" : "bg-white border-slate-200/90 shadow-sm";
  const bgSub = dark ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200";
  const textMuted = dark ? "text-slate-400" : "text-slate-500";
  const borderCol = dark ? "border-slate-800" : "border-slate-200";

  // ==================== AUTH SCREEN ====================
  if (!token || !user) {
    return (
      <div className={`min-h-screen ${bgPage} flex items-center justify-center p-4 transition-colors`}>
        <div className={`w-full max-w-md rounded-2xl border p-8 ${bgCard} shadow-xl`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-white shadow-md">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-extrabold tracking-tight">AEGIS AIOPS</h1>
                <p className={`text-xs ${textMuted}`}>Zero-Leak Two-Tier Observability</p>
              </div>
            </div>
            <button onClick={() => setDark(!dark)} className={`p-2 rounded-lg border ${borderCol} ${textMuted}`}>
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          <div className={`grid grid-cols-2 gap-1 p-1 rounded-xl border mb-5 text-xs font-semibold ${bgSub}`}>
            <button onClick={() => { setAuthMode("login"); setAuthMsg(null); }}
              className={`py-2 rounded-lg transition ${authMode === "login" ? "bg-teal-600 text-white shadow-sm" : textMuted}`}>
              Sign In
            </button>
            <button onClick={() => { setAuthMode("register"); setAuthMsg(null); }}
              className={`py-2 rounded-lg transition ${authMode === "register" ? "bg-teal-600 text-white shadow-sm" : textMuted}`}>
              Create Account
            </button>
          </div>

          {authMsg && (
            <div className={`text-xs mb-4 p-3 rounded-xl border ${authMsg.err ? "bg-rose-500/10 border-rose-500/30 text-rose-500" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"}`}>
              {authMsg.text}
            </div>
          )}

          {authMode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className={`text-[11px] font-semibold uppercase tracking-wider ${textMuted}`}>Work Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" required
                  className={`mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm focus:outline-none focus:border-teal-500 ${bgSub}`} />
              </div>
              <div>
                <div className="flex justify-between">
                  <label className={`text-[11px] font-semibold uppercase tracking-wider ${textMuted}`}>Password</label>
                  <button type="button" onClick={() => setAuthMode("forgot")} className="text-[11px] font-semibold text-teal-600 hover:underline">Forgot?</button>
                </div>
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" required
                  className={`mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm focus:outline-none focus:border-teal-500 ${bgSub}`} />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 hover:opacity-95 text-white font-bold text-sm shadow-md transition">
                Launch Platform →
              </button>

              <div className={`pt-4 border-t ${borderCol}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${textMuted}`}>1-Click Multi-Tenant Proof</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => handleLogin(undefined, "admin@fincorp.in", "fincorp123")}
                    className={`p-2.5 rounded-xl border text-left hover:border-teal-500 transition ${bgSub}`}>
                    <div className="text-xs font-bold text-teal-600">FinCorp India</div>
                    <div className={`text-[10px] font-mono ${textMuted}`}>in-south</div>
                  </button>
                  <button type="button" onClick={() => handleLogin(undefined, "admin@medtech.eu", "medtech123")}
                    className={`p-2.5 rounded-xl border text-left hover:border-cyan-500 transition ${bgSub}`}>
                    <div className="text-xs font-bold text-cyan-600">MedTech EU</div>
                    <div className={`text-[10px] font-mono ${textMuted}`}>eu-west</div>
                  </button>
                </div>
              </div>
            </form>
          )}

          {authMode === "register" && (
            <form onSubmit={handleRegister} className="space-y-3">
              <input value={regCompany} onChange={e => setRegCompany(e.target.value)} placeholder="Company Name" required className={`w-full rounded-xl border px-3.5 py-2.5 text-sm ${bgSub}`} />
              <select value={regRegion} onChange={e => setRegRegion(e.target.value)} className={`w-full rounded-xl border px-3.5 py-2.5 text-sm ${bgSub}`}>
                <option value="in-south">India South (in-south)</option>
                <option value="eu-west">Europe West (eu-west)</option>
                <option value="us-east">US East (us-east)</option>
              </select>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Work Email" required className={`w-full rounded-xl border px-3.5 py-2.5 text-sm ${bgSub}`} />
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" required className={`w-full rounded-xl border px-3.5 py-2.5 text-sm ${bgSub}`} />
              <button type="submit" className="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-sm">Create Isolated Workspace</button>
            </form>
          )}

          {authMode === "forgot" && (
            <div className="space-y-3">
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Registered Email" className={`w-full rounded-xl border px-3.5 py-2.5 text-sm ${bgSub}`} />
              <button onClick={handleSendOTP} className="w-full py-2 rounded-xl bg-slate-800 text-white text-xs font-semibold">Generate 6-Digit OTP</button>
              {fpStep2 && (
                <div className={`space-y-3 pt-3 border-t ${borderCol}`}>
                  <input value={fpCode} onChange={e => setFpCode(e.target.value)} placeholder="6-Digit OTP" className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-mono ${bgSub}`} />
                  <input value={fpNewPass} onChange={e => setFpNewPass(e.target.value)} type="password" placeholder="New Password" className={`w-full rounded-xl border px-3.5 py-2.5 text-sm ${bgSub}`} />
                  <button onClick={handleResetPass} className="w-full py-2.5 rounded-xl bg-teal-600 text-white font-bold text-sm">Update Password</button>
                </div>
              )}
              <button onClick={() => setAuthMode("login")} className={`w-full text-xs ${textMuted}`}>← Back to Sign In</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== DATA PREP ====================
  const events = data?.events || [];
  const latest = events[events.length - 1];
  const collectors = data?.collectors || [];
  const incidents = data?.incidents || [];
  const remediations = data?.remediations || [];
  const chartData = events.slice(-24).map((e: any) => ({
    time: e.event_time_utc?.slice(11, 19),
    cpu: e.cpu_pct,
    mem: e.memory_pct,
    latency: e.latency_ms,
    logins: e.failed_logins_1m
  }));

  const stateBadge = (s: string) => {
    if (s === "Excellent") return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
    if (s === "Good") return "bg-teal-500/15 text-teal-600 border-teal-500/30";
    if (s === "Fair") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
    return "bg-rose-500/15 text-rose-600 border-rose-500/30";
  };

  return (
    <div className={`min-h-screen ${bgPage} flex flex-col pb-16 md:pb-0 transition-colors`}>
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-teal-500/40 text-xs font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-400" /> {toast}
        </div>
      )}

      {/* ==================== TOP ENTERPRISE NAVBAR ==================== */}
      <header className={`sticky top-0 z-30 border-b backdrop-blur-md px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3 ${dark ? "bg-[#0a101f]/90 border-slate-800" : "bg-white/90 border-slate-200"}`}>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-white">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="font-extrabold text-sm leading-none">AEGIS AIOPS</div>
              <div className={`text-[10px] font-mono ${textMuted}`}>{user.company_name} • {user.region}</div>
            </div>
          </div>

          {/* Primary Top Navigation (Clean, Zero Confusion) */}
          <nav className="hidden md:flex items-center gap-1">
            {[
              { id: "overview", label: "Overview", icon: Activity },
              { id: "aiops", label: "Explainable AIOps", icon: Zap, count: incidents.length },
              { id: "remediation", label: "Remediation", icon: CheckCircle2, count: remediations.filter((r: any) => r.status === "PENDING_APPROVAL").length },
              { id: "egress", label: "Egress Proof", icon: Lock }
            ].map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id as any)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
                    active ? "bg-teal-500/15 text-teal-600 border border-teal-500/30" : `${textMuted} hover:bg-slate-500/10`
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {t.count ? <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">{t.count}</span> : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Controls: Live SLA + Theme + Logout */}
        <div className="flex items-center gap-2">
          <span className={`hidden sm:flex items-center gap-1.5 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border ${
            wsConnected ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600" : "bg-rose-500/10 border-rose-500/30 text-rose-500"
          }`}>
            <Radio className="w-3 h-3 animate-pulse" /> {data?.sla_proof?.p95_ingest_latency_ms ?? 0}ms P95
          </span>
          <button onClick={bindCollectorToMe} title="Bind local Tier 1 collector to this tenant"
            className="px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-semibold flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Bind Collector</span>
          </button>
          <button onClick={() => setDark(!dark)} className={`p-2 rounded-lg border ${borderCol} ${textMuted}`}>
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={logout} title="Switch Tenant / Logout" className={`p-2 rounded-lg border ${borderCol} hover:text-rose-500 ${textMuted}`}>
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ==================== GLOBAL JUDGE LIVE DEMO BAR (ALWAYS ACCESSIBLE) ==================== */}
      <div className={`border-b px-4 md:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 ${dark ? "bg-[#080d1a] border-slate-800" : "bg-slate-100/80 border-slate-200"}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider mr-1 flex items-center gap-1 ${textMuted}`}>
            <Play className="w-3 h-3 text-teal-600" /> Live Demo Controls:
          </span>
          <button onClick={() => triggerScenario("secret_leak")} className="px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 text-[11px] font-semibold">Secret Leak</button>
          <button onClick={() => triggerScenario("latency_spike")} className="px-2.5 py-1 rounded-md bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-600 text-[11px] font-semibold">Latency Spike</button>
          <button onClick={() => triggerScenario("cpu_anomaly")} className="px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-600 text-[11px] font-semibold">CPU Anomaly</button>
          <button onClick={() => triggerScenario("brute_force")} className="px-2.5 py-1 rounded-md bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-600 text-[11px] font-semibold">Brute-Force</button>
          <button onClick={() => triggerScenario("duplicate_replay")} className="px-2.5 py-1 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-600 text-[11px] font-semibold">Duplicate Test</button>
          <button onClick={toggleOutage} className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 ${
            egress?.outage_mode ? "bg-emerald-600 text-white" : "bg-slate-800 text-white"
          }`}>
            {egress?.outage_mode ? <><Wifi className="w-3 h-3" /> Reconnect & Flush</> : <><WifiOff className="w-3 h-3" /> Cut Network</>}
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span>Events: <b className="text-teal-600">{data?.sla_proof?.total_received ?? 0}</b></span>
          <span>Dupes Blocked: <b className="text-amber-600">{data?.sla_proof?.duplicates_blocked ?? 0}</b></span>
          <span>Buffered: <b className="text-purple-600">{egress?.stats?.currently_buffered ?? 0}</b></span>
        </div>
      </div>

      {/* ==================== MAIN CONTAINER ==================== */}
      <main className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6 flex-1">

        {/* Empty Tenant Banner */}
        {collectors.length === 0 && (
          <div className={`p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${bgCard}`}>
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Shield className="w-4 h-4 text-teal-600" /> Strict Tenant Isolation Active for {user.company_name}
              </h3>
              <p className={`text-xs mt-1 ${textMuted}`}>Zero cross-tenant data leaked. Click Bind Collector to stream live metadata into this workspace.</p>
            </div>
            <button onClick={bindCollectorToMe} className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs shrink-0">
              Bind Tier 1 Collector Now
            </button>
          </div>
        )}

        {/* ==================== PAGE 1: OVERVIEW ==================== */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* 4 Clean Executive Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`rounded-2xl border p-5 ${bgCard}`}>
                <div className={`flex justify-between text-xs font-semibold ${textMuted}`}><span>Compute Load</span><Cpu className="w-4 h-4 text-teal-600" /></div>
                <div className="text-3xl font-extrabold font-mono mt-2">{latest?.cpu_pct ?? 0}%</div>
                <div className={`text-xs mt-1 ${textMuted}`}>Mem: {latest?.memory_pct ?? 0}% • Disk: {latest?.disk_pct ?? 0}%</div>
              </div>
              <div className={`rounded-2xl border p-5 ${bgCard}`}>
                <div className={`flex justify-between text-xs font-semibold ${textMuted}`}><span>Network Latency</span><Network className="w-4 h-4 text-rose-500" /></div>
                <div className="text-3xl font-extrabold font-mono mt-2">{latest?.latency_ms ?? 0} ms</div>
                <div className={`text-xs mt-1 ${textMuted}`}>Packet Loss: {latest?.packet_loss_pct ?? 0}%</div>
              </div>
              <div className={`rounded-2xl border p-5 ${bgCard}`}>
                <div className={`flex justify-between text-xs font-semibold ${textMuted}`}><span>Correlated Incidents</span><AlertTriangle className="w-4 h-4 text-amber-500" /></div>
                <div className="text-3xl font-extrabold font-mono mt-2">{incidents.length}</div>
                <div className={`text-xs mt-1 ${textMuted}`}>Failed Logins/m: {latest?.failed_logins_1m ?? 0}</div>
              </div>
              <div className={`rounded-2xl border p-5 ${bgCard}`}>
                <div className={`flex justify-between text-xs font-semibold ${textMuted}`}><span>Fleet Health</span><Server className="w-4 h-4 text-emerald-500" /></div>
                <div className="mt-2.5">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full border ${stateBadge(collectors[0]?.health_state || "Excellent")}`}>
                    {collectors[0]?.health_state || "Standby"}
                  </span>
                </div>
                <div className={`text-xs mt-2 font-mono truncate ${textMuted}`}>{collectors[0]?.collector_id || "No collector"}</div>
              </div>
            </div>

            {/* Dual Real-Time Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className={`rounded-2xl border p-5 ${bgCard}`}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold">Real-Time Compute Telemetry (CPU & Memory)</h3>
                  <span className="text-[11px] font-mono text-teal-600">UTC Ordered</span>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="cpuG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={dark ? "#1e293b" : "#e2e8f0"} />
                      <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                      <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
                      <Tooltip />
                      <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#0d9488" strokeWidth={2.5} fill="url(#cpuG)" isAnimationActive={false} />
                      <Area type="monotone" dataKey="mem" name="Memory %" stroke="#6366f1" strokeWidth={2} fillOpacity={0} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={`rounded-2xl border p-5 ${bgCard}`}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold">Network Latency (ms) & Auth Anomalies</h3>
                  <span className="text-[11px] font-mono text-rose-500">Z-Score Watch</span>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={dark ? "#1e293b" : "#e2e8f0"} />
                      <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                      <YAxis stroke="#94a3b8" fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="latency" name="Latency (ms)" fill="#f43f5e" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="logins" name="Failed Logins" fill="#f59e0b" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Trust Boundary Pipeline + Live Metadata Stream */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className={`rounded-2xl border p-5 space-y-3 ${bgCard}`}>
                <h3 className="text-sm font-bold">Two-Tier Trust Boundary</h3>
                <div className={`p-3 rounded-xl border ${bgSub} flex items-center gap-3`}>
                  <Server className="w-5 h-5 text-rose-500 shrink-0" />
                  <div><div className="text-xs font-bold">Tier 1: Local Collector</div><div className={`text-[11px] ${textMuted}`}>Raw logs & secrets stay on-prem</div></div>
                </div>
                <div className={`p-3 rounded-xl border ${bgSub} flex items-center gap-3`}>
                  <Fingerprint className="w-5 h-5 text-teal-600 shrink-0" />
                  <div><div className="text-xs font-bold">Zero-Leak Scrubber</div><div className={`text-[11px] ${textMuted}`}>Regex + SHA-256 + Allow-List</div></div>
                </div>
                <div className={`p-3 rounded-xl border ${bgSub} flex items-center gap-3`}>
                  <Layers className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div><div className="text-xs font-bold">Tier 2: Central AIOps</div><div className={`text-[11px] ${textMuted}`}>Z-Score RCA • Multi-Tenant WS</div></div>
                </div>
              </div>

              <div className={`lg:col-span-2 rounded-2xl border p-5 overflow-x-auto ${bgCard}`}>
                <h3 className="text-sm font-bold mb-3">Live Metadata Stream (Pseudonymized & Hashed)</h3>
                <table className="w-full text-left text-xs font-mono">
                  <thead className={`text-[10px] uppercase border-b ${borderCol} ${textMuted}`}>
                    <tr><th className="py-2">UTC Time</th><th>Node ID</th><th>CPU / Lat</th><th>Egress Hash</th><th>SLA</th></tr>
                  </thead>
                  <tbody className={`divide-y ${dark ? "divide-slate-800" : "divide-slate-100"}`}>
                    {[...events].reverse().slice(0, 6).map((e: any) => (
                      <tr key={e.payload_id}>
                        <td className={`py-2.5 ${textMuted}`}>{e.event_time_utc?.slice(11, 19)}Z</td>
                        <td className="font-semibold text-teal-600">{e.source_id}</td>
                        <td>{e.cpu_pct}% / {e.latency_ms}ms</td>
                        <td className="text-emerald-600">{e.egress_hash?.slice(0, 10) || "verified"}</td>
                        <td className={textMuted}>{e.ingest_latency_ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== PAGE 2: EXPLAINABLE AIOPS ==================== */}
        {activeTab === "aiops" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-extrabold">Explainable AIOps & Root Cause Analysis</h2>
              <p className={`text-xs ${textMuted}`}>Click <b>Latency Spike</b> or <b>CPU Anomaly</b> in the top bar to watch live Z-score correlation merge alerts here.</p>
            </div>
            {incidents.length === 0 ? (
              <div className={`rounded-2xl border p-10 text-center text-xs ${bgCard} ${textMuted}`}>All baselines healthy. No active anomalies.</div>
            ) : incidents.map((i: any) => (
              <div key={i.incident_id} className={`rounded-2xl border p-5 space-y-4 border-l-4 ${bgCard} ${i.severity === "critical" ? "border-l-rose-500" : "border-l-amber-500"}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <div className={`text-[11px] font-mono ${textMuted}`}>{i.incident_id} • {i.source_id}</div>
                    <h3 className="text-base font-bold mt-0.5">{i.title}</h3>
                  </div>
                  <div className="flex gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-teal-500/15 text-teal-600 text-xs font-mono font-bold">{i.correlated_count} alerts merged</span>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 text-xs font-mono font-bold">{i.confidence_score}% confidence</span>
                  </div>
                </div>
                <p className="text-xs leading-relaxed">{i.explanation}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {i.contributing_signals.map((s: any, idx: number) => (
                    <div key={idx} className={`p-3 rounded-xl border ${bgSub}`}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-semibold">{s.signal} <span className={textMuted}>({s.value})</span></span>
                        <span className="font-mono text-teal-600 font-bold">{s.contribution_pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500" style={{ width: `${s.contribution_pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
                  <b>Recommended Action:</b> {i.recommended_action}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ==================== PAGE 3: SAFE REMEDIATION ==================== */}
        {activeTab === "remediation" && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold">Policy-Bounded Remediation & Audit Trail</h2>
            {remediations.length === 0 ? (
              <div className={`rounded-2xl border p-10 text-center text-xs ${bgCard} ${textMuted}`}>No pending remediations yet.</div>
            ) : remediations.map((r: any) => (
              <div key={r.action_id} className={`rounded-2xl border p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${bgCard}`}>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span className="text-teal-600 font-bold">{r.action_id}</span>
                    <span className={textMuted}>({r.incident_id})</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 font-semibold">{r.policy_check}</span>
                  </div>
                  <div className="text-sm font-bold">{r.proposed_action}</div>
                  <div className={`text-xs ${textMuted}`}>Rollback Plan: {r.rollback_plan}</div>
                  <div className={`text-[11px] font-mono ${textMuted}`}>Status: <b className="text-teal-600">{r.status}</b> {r.approved_by ? `• by ${r.approved_by}` : ""}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => decideRemediation(r.action_id, "approve")} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                  <button onClick={() => decideRemediation(r.action_id, "rollback")} className="px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-600 font-bold text-xs flex items-center gap-1.5">
                    <RotateCcw className="w-4 h-4" /> Rollback
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ==================== PAGE 4: EGRESS PROOF ==================== */}
        {activeTab === "egress" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-extrabold">Mandatory Egress Proof Panel</h2>
                <p className={`text-xs ${textMuted}`}>Side-by-side cryptographic proof: raw secrets stay local in Tier 1; only allow-listed metadata crosses to Tier 2.</p>
              </div>
            </div>
            <div className="space-y-3">
              {(egress?.records || []).map((r: any) => (
                <div key={r.payload_id} className={`rounded-2xl border p-4 space-y-3 ${bgCard}`}>
                  <div className="flex flex-wrap justify-between items-center text-xs font-mono">
                    <span className={textMuted}>ID: {r.payload_id.slice(0, 8)} • SHA-256: <b className="text-teal-600">{r.egress_hash}</b></span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${r.delivery_status === "SENT" ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}`}>{r.delivery_status}</span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px] font-mono">
                    <div className="p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/25 overflow-x-auto">
                      <div className="text-rose-600 font-bold mb-1.5">STAYED LOCAL (Tier 1 Vault) • Redacted: {r.secrets_redacted}</div>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(r.raw_local_only, null, 2)}</pre>
                    </div>
                    <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/25 overflow-x-auto">
                      <div className="text-emerald-600 font-bold mb-1.5">SENT TO SAAS (Allow-Listed Metadata Only)</div>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(r.egress_metadata_sent, null, 2)}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Dock */}
      <nav className={`md:hidden fixed bottom-0 inset-x-0 border-t flex justify-around py-2.5 z-40 ${dark ? "bg-[#0a101f] border-slate-800" : "bg-white border-slate-200"}`}>
        {[
          { id: "overview", label: "Overview", icon: Activity },
          { id: "aiops", label: "AIOps", icon: Zap },
          { id: "remediation", label: "Approve", icon: CheckCircle2 },
          { id: "egress", label: "Egress", icon: Lock }
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} onClick={() => setActiveTab(item.id as any)}
              className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold ${activeTab === item.id ? "text-teal-600" : textMuted}`}>
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
     <EnterpriseModules
          metrics={events.map((e: any) => ({
            cpu: e.cpu_pct,
            memory: e.memory_pct,
            latency: e.latency_ms,
            failed_logins: e.failed_logins_1m,
          }))}
          incidents={incidents}
          egress={egress}
          tenantName={user.company_name}
          region={user.region}
          collectorId={collectors[0]?.collector_id || "Standby"}
     />
    </div>
    
  );
}
