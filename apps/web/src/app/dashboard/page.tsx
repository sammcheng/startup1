"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";

import { ApiError, api } from "@/lib/api";
import type { DashboardSummaryResponse } from "@/types/dashboard";

const QUICK_LINKS = [
  { href: "/marketplace",         label: "Browse Marketplace", blurb: "Find tools to plug into your workflows.",          icon: "⊞" },
  { href: "/dashboard/tools/new", label: "List a Tool",        blurb: "Upload your project and start earning.",           icon: "⊕" },
  { href: "/dashboard/api-keys",  label: "API Keys",           blurb: "Create, copy, and revoke keys.",                   icon: "⌘" },
];

export default function DashboardPage() {
  const { getToken, isLoaded } = useAuth();
  const { user } = useUser();
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const data = await api.get<DashboardSummaryResponse>("/dashboard/summary", { token });
      setSummary(data);
    } catch (loadError) {
      setError(
        loadError instanceof ApiError
          ? loadError.message
          : "We couldn’t load your dashboard right now."
      );
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    void loadSummary();
  }, [isLoaded, loadSummary]);

  const displayName =
    summary?.display_name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "there";

  const stats = [
    { label: "API calls this month",  val: summary ? fmt(summary.stats.total_api_calls_this_month) : "—", helper: "↑ vs last month" },
    { label: "Total spend",           val: summary ? fmtUSD(summary.stats.total_spend_this_month)   : "—", helper: "This month"      },
    { label: "Total earned",          val: summary ? fmtUSD(summary.stats.total_earned_this_month)  : "—", helper: "Seller payouts"  },
    { label: "Active tools",          val: summary ? String(summary.stats.active_tools)             : "—", helper: "Currently live"  },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>
          Hackmarket Dashboard
        </p>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(22px,3vw,32px)", color: "var(--text)", marginBottom: 6 }}>
          Welcome back, {displayName}
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)" }}>Your API activity and tools at a glance.</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 28 }}>
        {stats.map((s) => (
          <div
            key={s.label}
            className="stat-card"
            style={isLoading ? { opacity: 0.75 } : undefined}
          >
            <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 14 }}>
              {s.label}
            </p>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 700, color: "var(--text)", letterSpacing: "-.02em", marginBottom: 6 }}>
              {s.val}
            </p>
            <p style={{ fontSize: 12, color: "var(--faint)" }}>{s.helper}</p>
          </div>
        ))}
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 16,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 12,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <p style={{ fontSize: 13, color: "#fecaca" }}>{error}</p>
          <button
            type="button"
            onClick={() => void loadSummary()}
            style={{
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              padding: "8px 12px",
              background: "transparent",
              color: "white",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr .6fr", gap: 16 }}>
        {/* Activity feed */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 4 }}>
                Recent Activity
              </p>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Last API calls</h2>
            </div>
            <Link href="/dashboard/usage" style={{
              background: "none", border: "1px solid var(--border)", borderRadius: 6,
              padding: "5px 12px", fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)",
            }}>
              View all →
            </Link>
          </div>
          {isLoading ? (
            <div style={{ padding: "40px 20px", fontSize: 13, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>
              Loading recent activity…
            </div>
          ) : summary?.recent_activity?.length ? (
            <table className="data-table">
              <thead>
                <tr><th>Tool</th><th>Status</th><th>Latency</th><th>Cost</th><th>When</th></tr>
              </thead>
              <tbody>
                {summary.recent_activity.map((item) => (
                  <tr key={item.id}>
                    <td style={{ color: "var(--text)", fontWeight: 500 }}>{item.tool_name}</td>
                    <td>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: item.status_code >= 400 ? "var(--red)" : "var(--green)", fontWeight: 600 }}>
                        {item.status_code}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{item.response_time_ms}ms</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{fmtUSD(item.cost)}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--faint)" }}>
                      {new Date(item.request_timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ padding: "40px 20px", fontSize: 13, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>
              No API usage yet. Activity will appear once requests start flowing.
            </p>
          )}
        </div>

        {/* Quick links */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                padding: "16px 18px", display: "block", transition: "border-color .2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 15, color: "var(--blue)" }}>{link.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{link.label}</span>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{link.blurb}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}
function fmtUSD(v: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v || 0));
}
