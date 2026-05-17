"use client";

// Builder Dashboard — ported from kc:frontend/src/screens/Dashboard.jsx.
// Tries main's existing endpoints (/v1/seller/dashboard if authed,
// /v1/tools?sort_by=popular for the table); falls through to kc's mocks
// so the page always renders something meaningful.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Tool, ToolListResponse } from "@/types/tool";

interface StatCard {
  label: string;
  value: string;
}

interface MonthlyEarning {
  month: string;
  value: number;
}

interface DashboardModule {
  name: string;
  status: string;
  earnings: number;
  integrations: number;
  slug?: string;
}

const STATS_FALLBACK: StatCard[] = [
  { label: "Total Earnings", value: "$2,340" },
  { label: "Live Modules", value: "3" },
  { label: "Total Integrations", value: "142" },
  { label: "In Review", value: "1" },
];

const EARNINGS_FALLBACK: MonthlyEarning[] = [
  { month: "Nov", value: 180 },
  { month: "Dec", value: 260 },
  { month: "Jan", value: 340 },
  { month: "Feb", value: 410 },
  { month: "Mar", value: 520 },
  { month: "Apr", value: 630 },
];

const MODULES_FALLBACK: DashboardModule[] = [
  { name: "AuthForge", status: "Live", earnings: 1200, integrations: 67 },
  { name: "NotifyStack", status: "Live", earnings: 800, integrations: 89 },
  { name: "DataPour", status: "Live", earnings: 340, integrations: 21 },
  { name: "CacheLayer", status: "Manual Review", earnings: 0, integrations: 0 },
];

interface ActivityItem {
  icon: string;
  color: string;
  text: string;
  when: string;
}

const ACTIVITY: ActivityItem[] = [
  {
    icon: "✓",
    color: "#16a34a",
    text: "AuthForge integrated by Stitchroom",
    when: "2h ago",
  },
  {
    icon: "$",
    color: "#16a34a",
    text: "$45 royalty earned from NotifyStack",
    when: "8h ago",
  },
  {
    icon: "★",
    color: "#d97706",
    text: "New 5-star review on DataPour",
    when: "1d ago",
  },
  {
    icon: "✉",
    color: "#2563eb",
    text: "Integration support request from Pearwell",
    when: "2d ago",
  },
];

function statusLabel(status: string): string {
  switch (status) {
    case "live":
      return "Live";
    case "processing":
      return "Processing";
    case "draft":
      return "Draft";
    case "paused":
      return "Paused";
    case "rejected":
      return "Rejected";
    case "pending_review":
      return "Manual Review";
    case "sandbox_running":
    case "pending_sandbox_test":
      return "AI Review";
    case "sandbox_passed":
      return "Sandbox Passed";
    case "sandbox_failed":
      return "Sandbox Failed";
    case "approved":
      return "Approved";
    default:
      return status;
  }
}

function statusToColor(s: string): { bg: string; fg: string } {
  if (s === "Live" || s === "live") {
    return { bg: "rgba(22,163,74,0.12)", fg: "#16a34a" };
  }
  if (s === "Manual Review" || s === "pending_review") {
    return { bg: "rgba(217,119,6,0.14)", fg: "#d97706" };
  }
  if (
    s === "AI Review" ||
    s === "sandbox_running" ||
    s === "pending_sandbox_test"
  ) {
    return { bg: "rgba(99,102,241,0.14)", fg: "#6366f1" };
  }
  if (s === "Rejected" || s === "rejected" || s === "Sandbox Failed") {
    return { bg: "rgba(220,38,38,0.12)", fg: "#dc2626" };
  }
  return { bg: "rgba(107,104,96,0.12)", fg: "#6b6860" };
}

export default function DashboardPage() {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await api.get<ToolListResponse>(
          "/tools?sort_by=popular&limit=20",
          { cache: "no-store" },
        );
        if (alive) setTools(resp.items);
      } catch (err) {
        if (alive) {
          setError((err as Error).message || "Failed to load tools");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dashboardModules = useMemo<DashboardModule[]>(() => {
    if (!tools || tools.length === 0) return MODULES_FALLBACK;
    return tools.slice(0, 12).map((t) => {
      const totalRequests = t.total_requests ?? 0;
      const priceCents = Math.round(
        parseFloat((t.price_per_request as unknown as string) ?? "0") * 100,
      );
      return {
        name: t.name,
        status: statusLabel(t.status),
        earnings: priceCents > 0 ? Math.round((priceCents * totalRequests) / 100) : 0,
        integrations: totalRequests,
        slug: t.slug,
      };
    });
  }, [tools]);

  const stats = useMemo<StatCard[]>(() => {
    if (!tools || tools.length === 0) return STATS_FALLBACK;
    const live = tools.filter((t) => t.status === "live").length;
    const inReview = tools.filter(
      (t) => t.status === "processing" || t.status === "draft",
    ).length;
    const integrations = tools.reduce(
      (sum, t) => sum + (t.total_requests ?? 0),
      0,
    );
    const earnings = dashboardModules.reduce((sum, m) => sum + m.earnings, 0);
    return [
      {
        label: "Total Earnings",
        value: `$${earnings.toLocaleString()}`,
      },
      { label: "Live Modules", value: String(live) },
      { label: "Total Integrations", value: integrations.toLocaleString() },
      { label: "In Review", value: String(inReview) },
    ];
  }, [tools, dashboardModules]);

  const earnings = EARNINGS_FALLBACK;
  const maxE = Math.max(...earnings.map((e) => e.value), 1);

  return (
    <main
      className="kc-demo-scope"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        paddingTop: 92,
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "0 28px",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 36,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--blue)",
              }}
            >
              Builder dashboard
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 32,
                color: "var(--text)",
                margin: "12px 0 0",
                letterSpacing: "-0.01em",
              }}
            >
              Welcome back.
            </h1>
            <p
              style={{
                color: "var(--muted)",
                fontSize: 14.5,
                marginTop: 6,
              }}
            >
              Last login 2 hours ago · Next payout in 12 days
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link
              href="/marketplace"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 16px",
                borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: 13.5,
                fontWeight: 500,
              }}
            >
              Browse marketplace
            </Link>
            <Link
              href="/submit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 18px",
                borderRadius: 8,
                background: "var(--blue)",
                color: "#fff",
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              + Submit a build
            </Link>
          </div>
        </header>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12.5,
              color: "var(--muted)",
              marginBottom: 18,
              background: "var(--card)",
            }}
          >
            Showing demo data — live API unavailable ({error.slice(0, 80)}).
          </div>
        )}

        {/* Stats */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginBottom: 28,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "20px 22px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--muted)",
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 28,
                  color: "var(--text)",
                  marginTop: 10,
                  letterSpacing: "-0.01em",
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </section>

        {/* Chart + Activity */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr",
            gap: 18,
            marginBottom: 28,
          }}
        >
          {/* Earnings chart */}
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "22px 24px 26px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 22,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: 17,
                    color: "var(--text)",
                  }}
                >
                  Earnings, last 6 months
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    marginTop: 4,
                  }}
                >
                  Across all live modules
                </div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--elevated)",
                  fontSize: 12,
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: "var(--blue)",
                  }}
                />
                Total
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${earnings.length}, 1fr)`,
                gap: 18,
                alignItems: "end",
                height: 200,
              }}
            >
              {earnings.map((e) => {
                const h = (e.value / maxE) * 100;
                return (
                  <div
                    key={e.month}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      height: "100%",
                      justifyContent: "flex-end",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        maxWidth: 64,
                        background:
                          "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
                        height: `${h}%`,
                        borderRadius: 6,
                        minHeight: 8,
                        transition: "height 0.5s ease",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: -22,
                          left: "50%",
                          transform: "translateX(-50%)",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          color: "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        ${e.value}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: 11.5,
                        color: "var(--muted)",
                        fontFamily: "var(--font-mono)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {e.month}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Activity feed */}
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "22px 24px 26px",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 17,
                color: "var(--text)",
              }}
            >
              This week
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--muted)",
                marginTop: 4,
                marginBottom: 18,
              }}
            >
              Activity across your modules
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {ACTIVITY.map((a, i) => (
                <li
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: "var(--elevated)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      color: a.color,
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                    aria-hidden
                  >
                    {a.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.4,
                        color: "var(--text)",
                      }}
                    >
                      {a.text}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        marginTop: 2,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {a.when}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Modules table */}
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "20px 24px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 17,
                  color: "var(--text)",
                }}
              >
                Your modules
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                {dashboardModules.length} total
              </div>
            </div>
          </div>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13.5,
            }}
          >
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <Th>Module</Th>
                <Th>Status</Th>
                <Th align="right">Earnings</Th>
                <Th align="right">Integrations</Th>
                <Th align="right"></Th>
              </tr>
            </thead>
            <tbody>
              {dashboardModules.map((m, i) => {
                const colors = statusToColor(m.status);
                return (
                  <tr
                    key={`${m.name}-${i}`}
                    style={{
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    <Td>
                      <div style={{ fontWeight: 500, color: "var(--text)" }}>
                        {m.name}
                      </div>
                    </Td>
                    <Td>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 10px",
                          borderRadius: 999,
                          background: colors.bg,
                          color: colors.fg,
                          fontSize: 12,
                          fontWeight: 500,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: "currentColor",
                          }}
                        />
                        {m.status}
                      </span>
                    </Td>
                    <Td align="right">
                      <span
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--text)",
                        }}
                      >
                        {m.earnings ? `$${m.earnings.toLocaleString()}` : "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <span
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--text)",
                        }}
                      >
                        {m.integrations
                          ? m.integrations.toLocaleString()
                          : "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      {m.slug ? (
                        <Link
                          href={`/tools/${m.slug}`}
                          style={{
                            color: "var(--blue)",
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                        >
                          View →
                        </Link>
                      ) : (
                        <span
                          style={{
                            color: "var(--muted)",
                            fontSize: 13,
                          }}
                        >
                          —
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "12px 20px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--muted)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "16px 20px",
        textAlign: align,
        color: "var(--text)",
      }}
    >
      {children}
    </td>
  );
}
