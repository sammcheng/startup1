"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useToast } from "@/components/ui/Toast";
import { api, buildQuery } from "@/lib/api";
import type { UsageSummaryResponse } from "@/types/usage";

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export default function UsagePage() {
  const { getToken, isLoaded } = useAuth();
  const defaults = defaultDateRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const { pushToast } = useToast();

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    void loadUsage();
  }, [getToken, isLoaded, startDate, endDate]);

  async function loadUsage() {
    if (startDate > endDate) {
      setDateError("Start date must be before end date.");
      return;
    }
    setDateError(null);
    setIsLoading(true);
    try {
      const token = await getToken();
      const query = buildQuery({
        start_date: startDate,
        end_date: endDate,
        granularity: "day",
      });
      const response = await api.get<UsageSummaryResponse>(`/usage/me${query}`, { token });
      setUsage(response);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load usage.");
      pushToast({ title: "Could not load usage", message: "Please try again.", variant: "error" });
    } finally {
      setIsLoading(false);
    }
  }

  const lineData = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const bucket of usage?.buckets ?? []) {
      const key = bucket.period_start.slice(0, 10);
      grouped.set(key, (grouped.get(key) ?? 0) + bucket.total_requests);
    }
    return Array.from(grouped.entries(), ([date, requests]) => ({ date, requests }));
  }, [usage]);

  const barData = useMemo(() => {
    return (usage?.by_tool ?? []).map((item) => ({
      name: item.tool_name,
      value: Number(item.total_revenue ?? item.total_cost ?? 0),
    }));
  }, [usage]);

  function exportCsv() {
    if (!usage) {
      return;
    }
    const rows = [
      ["date", "tool_name", "requests", "cost", "avg_response_time_ms"],
      ...usage.buckets.map((bucket) => [
        bucket.period_start.slice(0, 10),
        bucket.tool_name,
        String(bucket.total_requests),
        String(bucket.total_cost),
        String(bucket.avg_response_time ?? ""),
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `usage-${startDate}-to-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div>
          <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>Analytics</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--text)", marginBottom: 6 }}>Usage</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)" }}>API call history and spend breakdown.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
          <label style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            Start
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="input" style={{ display: "block", marginTop: 4, width: 160, fontSize: 13 }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            End
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="input" style={{ display: "block", marginTop: 4, width: 160, fontSize: 13 }} />
          </label>
          <button onClick={exportCsv} disabled={!usage} style={{
            padding: "10px 18px", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--muted)", fontSize: 13, cursor: "pointer",
            opacity: !usage ? .4 : 1, fontFamily: "var(--font-mono)",
          }}>
            Export CSV
          </button>
        </div>
      </div>

      {dateError && <div style={{ background: "rgba(202,138,4,.08)", border: "1px solid rgba(202,138,4,.2)", borderRadius: "var(--radius-sm)", padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "var(--yellow)" }}>{dateError}</div>}
      {error && <div style={{ background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: "var(--radius-sm)", padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "var(--red)" }}>{error}</div>}

      {/* Metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total requests",    val: usage ? formatInt(usage.total_requests) : isLoading ? "…" : "—" },
          { label: "Total cost",        val: usage ? formatCurrency(usage.total_cost) : isLoading ? "…" : "—" },
          { label: "Avg response time", val: usage?.avg_response_time != null ? `${usage.avg_response_time.toFixed(0)}ms` : isLoading ? "…" : "—" },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 14 }}>{s.label}</p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 700, color: "var(--text)", letterSpacing: "-.02em" }}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {[
          { title: "Requests over time", chart: (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--faint)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--faint)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                <Line type="monotone" dataKey="requests" stroke="var(--green)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )},
          { title: "Cost by tool", chart: (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} barSize={14}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--faint)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--faint)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                <Bar dataKey="value" fill="var(--blue)" opacity={0.7} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )},
        ].map((panel) => (
          <div key={panel.title} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 24 }}>
            <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 16 }}>{panel.title}</p>
            <div style={{ height: 200 }}>{panel.chart}</div>
          </div>
        ))}
      </div>

      {/* Breakdown table */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Daily breakdown</h3>
        </div>
        {isLoading ? (
          <div style={{ padding: 20 }}>
            {[...Array(4)].map((_, i) => <div key={i} className="animate-shimmer" style={{ height: 36, borderRadius: 6, marginBottom: 8 }} />)}
          </div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Date</th><th>Tool</th><th>Requests</th><th>Cost</th><th>Avg latency</th></tr></thead>
            <tbody>
              {usage?.buckets.length ? usage.buckets.map((b) => (
                <tr key={`${b.period_start}-${b.tool_id}`}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{b.period_start.slice(0,10)}</td>
                  <td style={{ color: "var(--text)", fontWeight: 500 }}>{b.tool_name}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{formatInt(b.total_requests)}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{formatCurrency(b.total_cost)}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--green)" }}>
                    {b.avg_response_time != null ? `${b.avg_response_time.toFixed(0)}ms` : "—"}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5} style={{ padding: "40px 20px", textAlign: "center", color: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  No usage records found. Try widening the date range or make a few API calls.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function formatInt(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function escapeCsv(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
