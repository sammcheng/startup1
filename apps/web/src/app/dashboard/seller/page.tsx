"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

import { api } from "@/lib/api";
import type { SellerDashboardResponse, SellerToolSummary } from "@/types/seller";
import type { Tool } from "@/types/tool";

export default function SellerDashboardPage() {
  const { getToken, isLoaded } = useAuth();
  const [dashboard, setDashboard] = useState<SellerDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    void load();
  }, [getToken, isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      const token = await getToken();
      const data = await api.get<SellerDashboardResponse>("/seller/dashboard", { token });
      setDashboard(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load seller dashboard.");
    }
  }

  async function handlePause(tool: SellerToolSummary) {
    setIsBusy(true);
    try {
      const token = await getToken();
      await api.delete(`/tools/${tool.tool_id}`, { token });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pause tool.");
    } finally { setIsBusy(false); }
  }

  async function handleResume(tool: SellerToolSummary) {
    setIsBusy(true);
    try {
      const token = await getToken();
      await api.put<Tool>(`/tools/${tool.tool_id}`, { status: "live" }, { token });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resume tool.");
    } finally { setIsBusy(false); }
  }

  const revenueChangePct = useMemo(() => {
    const cur = Number(dashboard?.total_revenue_this_month ?? "0");
    const prev = Number(dashboard?.previous_month_revenue ?? "0");
    if (!prev) return cur > 0 ? 100 : 0;
    return ((cur - prev) / prev) * 100;
  }, [dashboard]);

  const chartData = (dashboard?.revenue_chart_data ?? []).map((p) => ({
    date: p.date.slice(5), // MM-DD
    amount: Number(p.amount || 0),
  }));

  const maxVal = Math.max(...chartData.map((d) => d.amount), 1);

  const METRICS = [
    { label: "Revenue this month", val: fmtUSD(dashboard?.total_revenue_this_month ?? "0"), helper: `${revenueChangePct >= 0 ? "+" : ""}${revenueChangePct.toFixed(1)}% vs last month` },
    { label: "Total API calls",    val: fmt(dashboard?.total_requests_this_month ?? 0),     helper: "Across all tools" },
    { label: "Active tools",       val: String(dashboard?.active_tools ?? 0),                helper: `${dashboard?.total_tools ?? 0} total tools` },
    { label: "Avg response time",  val: dashboard?.avg_response_time_ms != null ? `${dashboard.avg_response_time_ms.toFixed(0)}ms` : "—", helper: dashboard?.top_tool ? `Top earner: ${dashboard.top_tool.tool_name}` : "No earning tool yet" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>Seller Command Center</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(22px,3vw,28px)", color: "var(--text)", marginBottom: 6 }}>
            Manage listings and watch revenue move
          </h1>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>Track performance across your tools and spot opportunities.</p>
        </div>
        <Link href="/dashboard/tools/new" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "10px 22px", borderRadius: "var(--radius-sm)",
          background: "var(--blue)", color: "#fff",
          fontSize: 14, fontWeight: 600, flexShrink: 0,
        }}>
          + List New Tool
        </Link>
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: "var(--radius-sm)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--red)" }}>
          {error}
        </div>
      )}

      {/* Metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 24 }}>
        {METRICS.map((m) => (
          <div key={m.label} className="stat-card">
            <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 14 }}>{m.label}</p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 700, color: "var(--text)", letterSpacing: "-.02em", marginBottom: 6 }}>{m.val}</p>
            <p style={{ fontSize: 12, color: "var(--faint)" }}>{m.helper}</p>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 24, marginBottom: 20 }}>
        <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 6 }}>Revenue trend</p>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", marginBottom: 24 }}>Last 30 days</h2>
        {chartData.length > 0 ? (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={12}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--faint)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--faint)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  labelStyle={{ color: "var(--muted)" }}
                  itemStyle={{ color: "var(--blue)" }}
                />
                <Bar dataKey="amount" fill="var(--blue)" opacity={0.7} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          /* CSS bar chart fallback for empty/loading state */
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {[40,60,45,80,65,100,85].map((h, i) => (
              <div key={i} style={{
                flex: 1, height: `${h}%`, borderRadius: "4px 4px 0 0",
                background: "var(--blue-dim)", border: "1px solid rgba(37,99,235,.18)",
              }} />
            ))}
          </div>
        )}
      </div>

      {/* Tool listings */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Your listings</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>Tool</th><th>Status</th><th>Calls this month</th><th>Revenue</th><th>Avg latency</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {dashboard?.tools.length ? dashboard.tools.map((t) => (
              <tr key={t.tool_id}>
                <td>
                  <div style={{ fontWeight: 500, color: "var(--text)" }}>{t.tool_name}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>{t.slug}</div>
                </td>
                <td><StatusBadge status={t.status} /></td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{fmt(t.requests_this_month)}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--green)" }}>{fmtUSD(t.revenue_this_month)}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  {t.avg_response_time_ms != null ? `${t.avg_response_time_ms.toFixed(0)}ms` : "—"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <Link href={`/dashboard/tools/new?toolId=${t.tool_id}`} style={{
                      background: "none", border: "1px solid var(--border)", borderRadius: 5,
                      padding: "4px 10px", fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--font-mono)",
                    }}>
                      Edit
                    </Link>
                    {t.status === "live" ? (
                      <button onClick={() => void handlePause(t)} disabled={isBusy} style={{
                        background: "none", border: "1px solid rgba(220,38,38,.25)", borderRadius: 5,
                        padding: "4px 10px", fontSize: 11.5, color: "var(--red)", cursor: "pointer",
                        fontFamily: "var(--font-mono)", opacity: isBusy ? .5 : 1,
                      }}>
                        Pause
                      </button>
                    ) : (
                      <button onClick={() => void handleResume(t)} disabled={isBusy} style={{
                        background: "none", border: "1px solid rgba(22,163,74,.3)", borderRadius: 5,
                        padding: "4px 10px", fontSize: 11.5, color: "var(--green)", cursor: "pointer",
                        fontFamily: "var(--font-mono)", opacity: isBusy ? .5 : 1,
                      }}>
                        Resume
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} style={{ padding: "40px 20px", textAlign: "center", color: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  No tools listed yet. Create your first listing to light this dashboard up.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SellerToolSummary["status"] }) {
  const map: Record<string, [string, string]> = {
    live:       ["var(--green)", "status-live"],
    draft:      ["var(--faint)", "status-draft"],
    paused:     ["var(--yellow)", "status-paused"],
    processing: ["var(--blue)", "status-processing"],
    rejected:   ["var(--red)", "status-rejected"],
  };
  const [color, dotCls] = map[status] ?? map.draft;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 11, color, textTransform: "uppercase", letterSpacing: ".07em" }}>
      <span className={`status-dot ${dotCls}`} />
      {status}
    </span>
  );
}

function fmt(n: number) { return new Intl.NumberFormat("en-US").format(n); }
function fmtUSD(v: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v || 0));
}
