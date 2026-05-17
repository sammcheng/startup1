"use client";

// Builder Dashboard — derived from the local submissions store so the page
// is always populated. recharts powers the interactive charts.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  listSubmissions,
  type SubmissionRecord,
} from "@/lib/submissions";

// Inline name sanitizer — avoids an extra import that webpack tree-shaking
// or stale cached chunks have been confused by. Strips HTML tags + entities.
function sanitizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type RangeKey = "7d" | "30d" | "90d";
const RANGE_DAYS: Record<RangeKey, number> = { "7d": 7, "30d": 30, "90d": 90 };

// ─── helpers ────────────────────────────────────────────────────────────

function dollars(cents: number): string {
  if (cents >= 100_000_00) return `$${(cents / 100_000_00).toFixed(1)}M`;
  if (cents >= 1_000_00) return `$${(cents / 1_000_00).toFixed(1)}k`;
  if (cents >= 100) return `$${(cents / 100).toLocaleString()}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function num(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function pct(n: number, dp = 1): string {
  return `${n.toFixed(dp)}%`;
}

function dayLabel(d: Date, range: RangeKey): string {
  if (range === "7d")
    return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Deterministic-ish wave generator for synthetic time series.
function seededWave(seed: number, length: number, base: number, amp: number): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const drift = (i / length) * 0.4; // slight upward trend
    const noise = (r - 0.5) * 0.5;
    out.push(Math.max(0, Math.round(base * (1 + drift) + amp * noise)));
  }
  return out;
}

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#6366f1",
  "#0ea5e9",
  "#ec4899",
  "#8b5cf6",
];

const HEALTH_COLOR: Record<string, string> = {
  healthy: "#16a34a",
  degraded: "#d97706",
  outage: "#dc2626",
};

// ─── derive aggregates ──────────────────────────────────────────────────

interface Aggregate {
  liveTools: SubmissionRecord[];
  inReview: number;
  testing: number;
  totalInstalls: number;
  totalCalls7d: number;
  totalEarnings7d: number;
  avgUptime: number;
  avgLatencyMs: number;
  topReviews: { user: string; rating: number; tool: string; comment: string; when: string }[];
}

function aggregate(submissions: SubmissionRecord[]): Aggregate {
  const liveTools = submissions.filter((s) => s.stage === "listed");
  const inReview = submissions.filter((s) => s.stage === "manual_review").length;
  const testing = submissions.filter((s) => s.stage === "testing").length;
  const totalInstalls = liveTools.reduce(
    (sum, s) => sum + (s.live?.installs ?? 0),
    0,
  );
  const totalCalls7d = liveTools.reduce(
    (sum, s) => sum + (s.live?.api_calls_7d ?? 0),
    0,
  );
  const totalEarnings7d = liveTools.reduce(
    (sum, s) => sum + (s.live?.earnings_cents_7d ?? 0),
    0,
  );
  const avgUptime = liveTools.length
    ? liveTools.reduce((sum, s) => sum + (s.live?.uptime_pct ?? 0), 0) /
      liveTools.length
    : 0;
  const avgLatencyMs = liveTools.length
    ? liveTools.reduce(
        (sum, s) => sum + (s.metrics.avg_response_ms ?? 0),
        0,
      ) / liveTools.length
    : 0;
  const topReviews = liveTools
    .flatMap((s) =>
      (s.live?.reviews ?? []).map((r) => ({
        user: r.user,
        rating: r.rating,
        tool: s.name,
        comment: r.comment,
        when: r.posted_at,
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.when).getTime() - new Date(a.when).getTime(),
    )
    .slice(0, 6);

  return {
    liveTools,
    inReview,
    testing,
    totalInstalls,
    totalCalls7d,
    totalEarnings7d,
    avgUptime,
    avgLatencyMs,
    topReviews,
  };
}

// ─── time series builders (synthetic, but keyed off real aggregates) ────

interface RevPoint {
  day: string;
  revenue: number;
  calls: number;
}

function buildRevenueSeries(
  agg: Aggregate,
  range: RangeKey,
): RevPoint[] {
  const days = RANGE_DAYS[range];
  // Scale daily revenue so the visible total matches the live "7d" number
  // proportionally.
  const baseDaily = (agg.totalEarnings7d / 7) || 4500;
  const callDaily = (agg.totalCalls7d / 7) || 9500;
  const revWave = seededWave(42 + days, days, baseDaily, baseDaily * 0.35);
  const callWave = seededWave(99 + days, days, callDaily, callDaily * 0.35);
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return {
      day: dayLabel(d, range),
      revenue: revWave[i],
      calls: callWave[i],
    };
  });
}

interface MixSlice {
  name: string;
  value: number;
  slug: string;
}

function buildRevenueMix(agg: Aggregate): MixSlice[] {
  return agg.liveTools
    .map((t) => ({
      name: t.name,
      slug: t.slug,
      value: t.live?.earnings_cents_7d ?? 0,
    }))
    .sort((a, b) => b.value - a.value);
}

interface LeaderRow {
  name: string;
  slug: string;
  installs: number;
  calls_7d: number;
  earnings_7d: number;
  uptime: number;
  health: string;
}

function buildLeaderboard(agg: Aggregate): LeaderRow[] {
  return agg.liveTools
    .map((t) => ({
      name: sanitizeName(t.name),
      slug: t.slug,
      installs: t.live?.installs ?? 0,
      calls_7d: t.live?.api_calls_7d ?? 0,
      earnings_7d: t.live?.earnings_cents_7d ?? 0,
      uptime: t.live?.uptime_pct ?? 0,
      health: t.live?.health ?? "healthy",
    }))
    .sort((a, b) => b.earnings_7d - a.earnings_7d);
}

interface LatencyRow {
  name: string;
  p50: number;
  p95: number;
  p99: number;
}

function buildLatency(agg: Aggregate): LatencyRow[] {
  return agg.liveTools.map((t) => ({
    name: t.name,
    p50: t.metrics.p50_response_ms,
    p95: t.metrics.p95_response_ms,
    p99: t.metrics.p99_response_ms,
  }));
}

interface ActivityItem {
  kind: "install" | "earning" | "review" | "request" | "deploy";
  text: string;
  when: string;
}

function buildActivity(agg: Aggregate): ActivityItem[] {
  const items: ActivityItem[] = [];
  agg.liveTools.forEach((t) => {
    const live = t.live!;
    items.push({
      kind: "earning",
      text: `${dollars(live.earnings_cents_7d)} earned from ${t.name} this week`,
      when: live.listed_at,
    });
    if (live.installs > 0) {
      items.push({
        kind: "install",
        text: `${num(live.installs)} active installs on ${t.name}`,
        when: live.listed_at,
      });
    }
    (live.reviews ?? []).slice(0, 2).forEach((r) => {
      items.push({
        kind: r.is_feature_request ? "request" : "review",
        text: r.is_feature_request
          ? `Feature request on ${t.name}: ${r.comment.slice(0, 80)}…`
          : `★ ${r.rating} from ${r.user} on ${t.name}`,
        when: r.posted_at,
      });
    });
  });
  return items
    .sort(
      (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
    )
    .slice(0, 10);
}

function timeAgo(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const ACTIVITY_GLYPH: Record<ActivityItem["kind"], { icon: string; color: string }> = {
  install: { icon: "↗", color: "#2563eb" },
  earning: { icon: "$", color: "#16a34a" },
  review: { icon: "★", color: "#d97706" },
  request: { icon: "✦", color: "#6366f1" },
  deploy: { icon: "↑", color: "#16a34a" },
};

// ─── milestones ────────────────────────────────────────────────────────

interface Milestone {
  label: string;
  current: number;
  target: number;
  unit: string;
  format: (n: number) => string;
}

function buildMilestones(agg: Aggregate): Milestone[] {
  const mrrCents = agg.totalEarnings7d * 4; // rough monthly
  return [
    {
      label: "MRR — next tier",
      current: mrrCents,
      target: 50_000_00, // $50k
      unit: "cents",
      format: (n) => dollars(n),
    },
    {
      label: "Active installs",
      current: agg.totalInstalls,
      target: 1000,
      unit: "installs",
      format: (n) => num(n),
    },
    {
      label: "API calls / week",
      current: agg.totalCalls7d,
      target: 100_000,
      unit: "calls",
      format: (n) => num(n),
    },
  ];
}

// ─── Page ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [range, setRange] = useState<RangeKey>("30d");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setSubmissions(listSubmissions());
    setMounted(true);
  }, []);

  const agg = useMemo(() => aggregate(submissions), [submissions]);
  const revSeries = useMemo(() => buildRevenueSeries(agg, range), [agg, range]);
  const mix = useMemo(() => buildRevenueMix(agg), [agg]);
  const leaderboard = useMemo(() => buildLeaderboard(agg), [agg]);
  const latency = useMemo(() => buildLatency(agg), [agg]);
  const activity = useMemo(() => buildActivity(agg), [agg]);
  const milestones = useMemo(() => buildMilestones(agg), [agg]);

  // Deltas — period N vs previous period
  const half = Math.floor(revSeries.length / 2);
  const recent = revSeries.slice(half).reduce((s, p) => s + p.revenue, 0);
  const prior = revSeries.slice(0, half).reduce((s, p) => s + p.revenue, 0) || 1;
  const revDelta = ((recent - prior) / prior) * 100;
  const callsRecent = revSeries.slice(half).reduce((s, p) => s + p.calls, 0);
  const callsPrior = revSeries.slice(0, half).reduce((s, p) => s + p.calls, 0) || 1;
  const callsDelta = ((callsRecent - callsPrior) / callsPrior) * 100;

  if (!mounted) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          paddingTop: 120,
          textAlign: "center",
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
        }}
      >
        Loading dashboard…
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        paddingTop: 64,
        paddingBottom: 40,
      }}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px" }}>
        {/* ── Header */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div>
            <Eyebrow style={{ color: "var(--blue)" }}>Builder dashboard</Eyebrow>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 24,
                color: "var(--text)",
                margin: "4px 0 4px",
                letterSpacing: "-0.01em",
              }}
            >
              {agg.liveTools.length === 0
                ? "Submit a build to get started."
                : `You're earning across ${agg.liveTools.length} live tool${agg.liveTools.length === 1 ? "" : "s"}.`}
            </h1>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              {num(agg.totalCalls7d)} API calls · {dollars(agg.totalEarnings7d)} earned · last 7 days
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <RangeToggle range={range} onChange={setRange} />
            <Link href="/submit" style={primaryBtn}>
              + Submit a build
            </Link>
          </div>
        </header>

        {/* ── KPI strip — 4 cards with sparklines + deltas */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <KpiCard
            label="Revenue · 7d"
            value={dollars(agg.totalEarnings7d)}
            delta={revDelta}
            spark={revSeries.map((p) => p.revenue)}
            color="#16a34a"
          />
          <KpiCard
            label="API calls · 7d"
            value={num(agg.totalCalls7d)}
            delta={callsDelta}
            spark={revSeries.map((p) => p.calls)}
            color="#2563eb"
          />
          <KpiCard
            label="Active installs"
            value={num(agg.totalInstalls)}
            delta={null}
            spark={seededWave(7, 24, agg.totalInstalls / 24, 0.6)}
            color="#6366f1"
          />
          <KpiCard
            label="Avg uptime"
            value={pct(agg.avgUptime)}
            delta={null}
            spark={seededWave(11, 24, 99.5, 0.3).map((n) => Math.min(100, n))}
            color={agg.avgUptime >= 99.9 ? "#16a34a" : "#d97706"}
          />
        </section>

        {/* ── Revenue + mix */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr",
            gap: 12,
            marginBottom: 16,
          }}
        >
          {/* Revenue area chart */}
          <Card>
            <CardHead
              title="Revenue & calls"
              sub={`${revSeries.length}-day trend`}
              right={
                <Legend>
                  <LegendDot color="#16a34a" label="Revenue ($)" />
                  <LegendDot color="#2563eb" label="Calls" />
                </Legend>
              }
            />
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="grCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => dollars(v as number)}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => num(v as number)}
                  />
                  <Tooltip content={<RevTooltip />} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    stroke="#16a34a"
                    strokeWidth={2}
                    fill="url(#grRev)"
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="calls"
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#grCalls)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Revenue mix donut */}
          <Card>
            <CardHead
              title="Revenue mix"
              sub={`Past 7 days · ${mix.length} tools`}
            />
            {mix.length === 0 ? (
              <EmptyChart text="No live tools yet." />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 160, height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={mix}
                        innerRadius={48}
                        outerRadius={76}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                        stroke="var(--card)"
                        strokeWidth={2}
                      >
                        {mix.map((m, i) => (
                          <Cell key={m.slug} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<MixTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul
                  style={{
                    flex: 1,
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {mix.map((m, i) => {
                    const total = mix.reduce((s, x) => s + x.value, 0) || 1;
                    const share = (m.value / total) * 100;
                    return (
                      <li
                        key={m.slug}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 12,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            background: COLORS[i % COLORS.length],
                            flexShrink: 0,
                          }}
                        />
                        <Link
                          href={`/tools/${m.slug}`}
                          style={{
                            color: "var(--text)",
                            textDecoration: "none",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.name}
                        </Link>
                        <span style={{ color: "var(--muted)" }}>{dollars(m.value)}</span>
                        <span
                          style={{
                            color: "var(--faint)",
                            width: 38,
                            textAlign: "right",
                          }}
                        >
                          {share.toFixed(0)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        </section>

        {/* ── Milestones strip */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          {milestones.map((m) => (
            <MilestoneCard key={m.label} milestone={m} />
          ))}
        </section>

        {/* ── Leaderboard + Latency */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
            gap: 12,
            marginBottom: 16,
          }}
        >
          {/* Top tools leaderboard */}
          <Card>
            <CardHead
              title="Top tools · last 7d"
              sub="Sorted by earnings"
            />
            {leaderboard.length === 0 ? (
              <EmptyChart text="No tools listed yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {leaderboard.map((row, i) => {
                  const max = leaderboard[0].earnings_7d || 1;
                  const widthPct = (row.earnings_7d / max) * 100;
                  return (
                    <Link
                      key={row.slug}
                      href={`/tools/${row.slug}`}
                      style={{
                        display: "block",
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        textDecoration: "none",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {/* progress fill */}
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${widthPct}%`,
                          background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}18, transparent)`,
                          pointerEvents: "none",
                        }}
                      />
                      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            width: 22,
                            textAlign: "center",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: "var(--muted)",
                          }}
                        >
                          #{i + 1}
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: "var(--text)",
                            fontSize: 13.5,
                            flex: 1,
                          }}
                        >
                          {row.name}
                        </span>
                        <HealthDot health={row.health} uptime={row.uptime} />
                        <Stat tiny label="installs" value={num(row.installs)} />
                        <Stat tiny label="calls" value={num(row.calls_7d)} />
                        <Stat tiny label="earnings" value={dollars(row.earnings_7d)} color="#16a34a" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Latency bar chart */}
          <Card>
            <CardHead title="Latency percentiles" sub="ms across live tools" />
            {latency.length === 0 ? (
              <EmptyChart text="No live tools yet." />
            ) : (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={latency}
                    layout="vertical"
                    margin={{ top: 6, right: 10, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}ms`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10, fill: "var(--text)", fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                      width={84}
                    />
                    <Tooltip content={<LatencyTooltip />} />
                    <Bar dataKey="p50" fill="#16a34a" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="p95" fill="#d97706" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="p99" fill="#dc2626" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </section>

        {/* ── Activity feed + Reviews */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <Card>
            <CardHead title="Recent activity" sub="Across all live tools" />
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {activity.length === 0 ? (
                <li style={{ color: "var(--muted)", fontSize: 13, padding: 10 }}>No activity yet.</li>
              ) : (
                activity.map((a, i) => {
                  const g = ACTIVITY_GLYPH[a.kind];
                  return (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "8px 4px",
                      }}
                    >
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: `${g.color}1A`,
                          color: g.color,
                          fontWeight: 700,
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0,
                          fontSize: 14,
                        }}
                      >
                        {g.icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "var(--text)", fontSize: 13.2, lineHeight: 1.45 }}>
                          {a.text}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          {timeAgo(a.when)}
                        </div>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </Card>

          <Card>
            <CardHead
              title="Latest reviews & requests"
              sub={`${agg.topReviews.length} from your customers`}
            />
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {agg.topReviews.length === 0 ? (
                <li style={{ color: "var(--muted)", fontSize: 13, padding: 10 }}>No reviews yet.</li>
              ) : (
                agg.topReviews.map((r, i) => (
                  <li
                    key={i}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{r.user}</span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--muted)",
                        }}
                      >
                        on {r.tool}
                      </span>
                      <span style={{ marginLeft: "auto", color: "#d97706", fontSize: 11.5 }}>
                        {"★".repeat(r.rating)}
                        <span style={{ opacity: 0.3 }}>{"★".repeat(5 - r.rating)}</span>
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--muted)",
                        lineHeight: 1.5,
                      }}
                    >
                      {r.comment}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "var(--faint)",
                        marginTop: 4,
                      }}
                    >
                      {timeAgo(r.when)}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </section>

        {/* ── Pipeline status: testing / review / live */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <PipelineCard
            label="Testing"
            count={agg.testing}
            color="#6366f1"
            href="/approver?token=admin"
            hint={agg.testing === 0 ? "Inbox zero" : "Auto-completes within 18s"}
          />
          <PipelineCard
            label="Pending review"
            count={agg.inReview}
            color="#d97706"
            href="/approver?token=admin"
            hint={agg.inReview === 0 ? "Inbox zero" : "Waiting on approver"}
          />
          <PipelineCard
            label="Live tools"
            count={agg.liveTools.length}
            color="#16a34a"
            href="/marketplace"
            hint={`${dollars(agg.totalEarnings7d)} earned this week`}
          />
        </section>
      </div>
    </main>
  );
}

// ─── small components ──────────────────────────────────────────────────

function Eyebrow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      {children}
    </div>
  );
}

function CardHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 12,
        gap: 12,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 15,
            color: "var(--text)",
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--muted)",
              marginTop: 2,
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div
      style={{
        height: 200,
        display: "grid",
        placeItems: "center",
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}

function Legend({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      {children}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--muted)",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  delta,
  spark,
  color,
}: {
  label: string;
  value: string;
  delta: number | null;
  spark: number[];
  color: string;
}) {
  const data = spark.map((v, i) => ({ i, v }));
  return (
    <Card>
      <Eyebrow style={{ fontSize: 10 }}>{label}</Eyebrow>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 6,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 26,
            color: "var(--text)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        {delta !== null && (
          <DeltaBadge value={delta} />
        )}
      </div>
      <div style={{ height: 32, marginTop: 8, marginRight: -6, marginLeft: -6 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.8}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function DeltaBadge({ value }: { value: number }) {
  const up = value >= 0;
  const color = up ? "#16a34a" : "#dc2626";
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `${color}14`,
        padding: "2px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function RangeToggle({
  range,
  onChange,
}: {
  range: RangeKey;
  onChange: (r: RangeKey) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 2,
      }}
    >
      {(["7d", "30d", "90d"] as RangeKey[]).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          style={{
            padding: "5px 12px",
            borderRadius: 6,
            border: "none",
            background: range === r ? "var(--blue)" : "transparent",
            color: range === r ? "#fff" : "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            transition: "background 0.12s",
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function MilestoneCard({ milestone }: { milestone: Milestone }) {
  const progress = Math.min(100, (milestone.current / milestone.target) * 100);
  return (
    <Card>
      <Eyebrow style={{ fontSize: 10 }}>{milestone.label}</Eyebrow>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 6,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 20,
            color: "var(--text)",
            lineHeight: 1,
          }}
        >
          {milestone.format(milestone.current)}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          / {milestone.format(milestone.target)} ({progress.toFixed(0)}%)
        </div>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--bg)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: progress >= 100 ? "#16a34a" : "var(--blue)",
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </Card>
  );
}

function HealthDot({ health, uptime }: { health: string; uptime: number }) {
  const color = HEALTH_COLOR[health] ?? "#6b6860";
  return (
    <span
      title={`${health} · ${uptime.toFixed(2)}% uptime`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        color,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
        }}
      />
      {uptime.toFixed(1)}%
    </span>
  );
}

function Stat({
  label,
  value,
  color,
  tiny,
}: {
  label: string;
  value: string;
  color?: string;
  tiny?: boolean;
}) {
  return (
    <div
      style={{
        minWidth: tiny ? 60 : 72,
        textAlign: "right",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          color: color ?? "var(--text)",
          fontWeight: 600,
          fontSize: tiny ? 12 : 13,
          fontFamily: "var(--font-mono)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: "var(--faint)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function PipelineCard({
  label,
  count,
  color,
  href,
  hint,
}: {
  label: string;
  count: number;
  color: string;
  href: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "14px 18px",
        textDecoration: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        transition: "border-color 0.12s",
      }}
    >
      <div>
        <Eyebrow style={{ fontSize: 10 }}>{label}</Eyebrow>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 26,
            color,
            lineHeight: 1,
            marginTop: 4,
          }}
        >
          {count}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          {hint}
        </div>
      </div>
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          background: `${color}14`,
          color,
          display: "grid",
          placeItems: "center",
          fontSize: 18,
        }}
      >
        →
      </span>
    </Link>
  );
}

// ─── chart tooltips ────────────────────────────────────────────────────

interface TooltipPayload {
  value: number;
  payload: Record<string, unknown>;
  name?: string;
  dataKey?: string;
  color?: string;
}

function RevTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <TooltipShell>
      <div style={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div
          key={String(p.dataKey)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color }} />
          <span style={{ color: "var(--muted)" }}>{p.dataKey === "revenue" ? "Revenue" : "Calls"}:</span>
          <strong>{p.dataKey === "revenue" ? dollars(p.value) : num(p.value)}</strong>
        </div>
      ))}
    </TooltipShell>
  );
}

function MixTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <TooltipShell>
      <div style={{ color: "var(--text)", fontWeight: 600, fontSize: 12.5 }}>
        {String(p.payload.name)}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 2 }}>
        {dollars(p.value)} this week
      </div>
    </TooltipShell>
  );
}

function LatencyTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <TooltipShell>
      <div style={{ color: "var(--text)", fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div
          key={String(p.dataKey)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color }} />
          <span style={{ color: "var(--muted)" }}>{String(p.dataKey)}:</span>
          <strong>{p.value}ms</strong>
        </div>
      ))}
    </TooltipShell>
  );
}

function TooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
      }}
    >
      {children}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  background: "var(--blue)",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  fontFamily: "var(--font-body)",
  textDecoration: "none",
};
