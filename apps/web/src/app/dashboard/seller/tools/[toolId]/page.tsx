"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useParams } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "@/lib/api";
import type { SellerAnalyticsResponse } from "@/types/seller";
import type { Tool } from "@/types/tool";

const periods = ["7d", "30d", "90d", "all"] as const;

export default function SellerToolAnalyticsPage() {
  const params = useParams<{ toolId: string }>();
  const { getToken, isLoaded } = useAuth();
  const [period, setPeriod] = useState<(typeof periods)[number]>("30d");
  const [analytics, setAnalytics] = useState<SellerAnalyticsResponse | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isLoaded || !params.toolId) {
      return;
    }
    void loadData();
  }, [getToken, isLoaded, params.toolId, period]);

  async function loadData() {
    try {
      const token = await getToken();
      const [toolList, analyticsResponse] = await Promise.all([
        api.get<Tool[]>("/tools/me", { token }),
        api.get<SellerAnalyticsResponse>(`/seller/tools/${params.toolId}/analytics?period=${period}`, { token }),
      ]);
      setTool(toolList.find((item) => item.id === params.toolId) ?? null);
      setAnalytics(analyticsResponse);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load tool analytics.");
    }
  }

  async function updateTool(patch: Partial<Tool>) {
    setIsBusy(true);
    try {
      const token = await getToken();
      await api.put<Tool>(`/tools/${params.toolId}`, patch, { token });
      await loadData();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update tool.");
    } finally {
      setIsBusy(false);
    }
  }

  const requestData = useMemo(
    () =>
      (analytics?.requests_over_time ?? []).map((item) => ({
        date: item.date,
        count: item.count,
      })),
    [analytics]
  );
  const revenueData = useMemo(
    () =>
      (analytics?.revenue_over_time ?? []).map((item) => ({
        date: item.date,
        amount: Number(item.amount || 0),
      })),
    [analytics]
  );
  const responseTimeData = useMemo(() => {
    return (analytics?.requests_over_time ?? []).map((item) => ({
      date: item.date,
      p50: analytics?.p50_response_time_ms ?? 0,
      p95: analytics?.p95_response_time_ms ?? 0,
      p99: analytics?.p99_response_time_ms ?? 0,
    }));
  }, [analytics]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1d253e_0%,#0e1322_42%,#06070d_100%)] px-4 py-10 text-stone-100 md:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="rounded-[32px] border border-indigo-200/10 bg-black/30 p-8 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.35em] text-indigo-300/70">Tool Analytics</div>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">{tool?.name ?? "Tool analytics"}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">
                Watch requests, revenue, latency, and failures for one tool without losing sight of its live settings.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {periods.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPeriod(option)}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    period === option
                      ? "bg-indigo-300 text-stone-950"
                      : "border border-stone-700 text-stone-200 hover:border-indigo-300"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </section>

        {error && <section className="rounded-3xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">{error}</section>}

        <section className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Requests">
            <Chart data={requestData} dataKey="count" stroke="#60a5fa" />
          </ChartCard>
          <ChartCard title="Revenue">
            <Chart data={revenueData} dataKey="amount" stroke="#34d399" />
          </ChartCard>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Response time percentiles">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={responseTimeData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="p50" stroke="#f59e0b" dot={false} />
                  <Line type="monotone" dataKey="p95" stroke="#a855f7" dot={false} />
                  <Line type="monotone" dataKey="p99" stroke="#ef4444" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <section className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
            <div className="text-xs uppercase tracking-[0.25em] text-stone-400">Snapshot</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <MetricCard label="Unique users" value={String(analytics?.unique_users ?? 0)} />
              <MetricCard label="Avg response time" value={analytics?.avg_response_time_ms != null ? `${analytics.avg_response_time_ms.toFixed(0)}ms` : "—"} />
              <MetricCard label="Error rate" value={`${(analytics?.error_rate ?? 0).toFixed(1)}%`} />
              <MetricCard label="Top error" value={analytics?.top_errors[0]?.error_message ?? "None"} />
            </div>
          </section>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
            <div className="mb-5">
              <div className="text-xs uppercase tracking-[0.25em] text-stone-400">Error log</div>
              <h2 className="mt-2 text-2xl font-semibold text-stone-100">Recent failures and request details</h2>
            </div>
            <div className="overflow-hidden rounded-3xl border border-stone-800">
              <div className="grid grid-cols-[1fr_1.2fr_0.7fr_0.7fr_0.8fr] gap-4 bg-stone-900/80 px-5 py-3 text-xs uppercase tracking-[0.2em] text-stone-400">
                <div>Timestamp</div>
                <div>Error</div>
                <div>Status</div>
                <div>I/O bytes</div>
                <div>Latency</div>
              </div>
              <div className="divide-y divide-stone-800">
                {analytics?.recent_errors.length ? (
                  analytics.recent_errors.map((item) => (
                    <div key={`${item.timestamp}-${item.status_code}`} className="grid grid-cols-[1fr_1.2fr_0.7fr_0.7fr_0.8fr] gap-4 px-5 py-4 text-sm">
                      <div className="text-stone-300">{formatDateTime(item.timestamp)}</div>
                      <div className="text-stone-100">{item.error_message ?? "HTTP error"}</div>
                      <div className="text-red-300">{item.status_code}</div>
                      <div className="text-stone-300">{item.input_size_bytes}/{item.output_size_bytes}</div>
                      <div className="text-stone-300">{item.response_time_ms}ms</div>
                    </div>
                  ))
                ) : (
                  <div className="px-5 py-10 text-sm text-stone-400">No recent errors in this period.</div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
            <div className="mb-5">
              <div className="text-xs uppercase tracking-[0.25em] text-stone-400">Tool settings</div>
              <h2 className="mt-2 text-2xl font-semibold text-stone-100">Listing controls</h2>
            </div>
            <div className="space-y-4">
              <SettingRow
                label="Price per request"
                value={tool?.price_per_request ? formatCurrency(tool.price_per_request) : "Free"}
                actionLabel="Set to $0.01"
                onClick={() => void updateTool({ price_per_request: "0.01" })}
                disabled={isBusy}
              />
              <SettingRow
                label="Description"
                value={tool?.description ?? "No description"}
                actionLabel="Refresh description"
                onClick={() => void updateTool({ description: `${tool?.description ?? ""}\n\nUpdated from seller analytics.`.trim() })}
                disabled={isBusy}
              />
              <SettingRow
                label="Status"
                value={tool?.status ?? "unknown"}
                actionLabel={tool?.status === "live" ? "Pause tool" : "Resume tool"}
                onClick={() => void updateTool({ status: tool?.status === "live" ? "paused" : "live" })}
                disabled={isBusy}
              />
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function ChartCard(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
      <div className="text-xs uppercase tracking-[0.25em] text-stone-400">{props.title}</div>
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

function Chart(props: { data: Array<Record<string, string | number>>; dataKey: string; stroke: string }) {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={props.data}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#94a3b8" />
          <YAxis stroke="#94a3b8" />
          <Tooltip />
          <Line type="monotone" dataKey={props.dataKey} stroke={props.stroke} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-stone-800 bg-stone-900/70 p-5">
      <div className="text-xs uppercase tracking-[0.25em] text-stone-400">{props.label}</div>
      <div className="mt-3 text-2xl font-semibold text-stone-100">{props.value}</div>
    </div>
  );
}

function SettingRow(props: { label: string; value: string; actionLabel: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="rounded-3xl border border-stone-800 bg-stone-900/70 p-5">
      <div className="text-xs uppercase tracking-[0.25em] text-stone-400">{props.label}</div>
      <div className="mt-2 text-sm leading-6 text-stone-200">{props.value}</div>
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        className="mt-4 rounded-full border border-indigo-300/30 px-4 py-2 text-xs text-indigo-100 transition hover:border-indigo-300 disabled:opacity-50"
      >
        {props.actionLabel}
      </button>
    </div>
  );
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
