import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { fetchConverterTool } from "@/lib/converterTools";
import { LOCAL_FALLBACK_TOOLS } from "@/lib/localFallbackTools";
import ToolDocs from "@/components/docs/ToolDocs";
import type { Tool } from "@/types/tool";
import type { ToolDocumentation } from "@/types/docs";
import DemoRunner from "@/components/demo/DemoRunner";
import LiveBenchmark from "@/components/demo/LiveBenchmark";
import DemoTabs from "@/components/demos/DemoTabs";

export const dynamic = "force-dynamic";

// ── Data ───────────────────────────────────────────────────────────────────

async function fetchTool(slug: string): Promise<Tool | null> {
  try {
    return await api.get<Tool>(`/tools/${slug}`, { cache: "no-store" });
  } catch {
    try {
      return await fetchConverterTool(slug);
    } catch {
      return LOCAL_FALLBACK_TOOLS.find((t) => t.slug === slug) ?? null;
    }
  }
}

async function fetchToolDocs(slug: string): Promise<ToolDocumentation | null> {
  try {
    return await api.get<ToolDocumentation>(`/tools/${slug}/docs`, {
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

// ── Metadata ───────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = await fetchTool(slug);
  if (!tool) return { title: "Tool not found" };
  return {
    title: tool.name,
    description: tool.tagline,
    openGraph: {
      title: `${tool.name} — Hackmarket`,
      description: tool.tagline,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  nlp: "#3b82f6",
  computer_vision: "#8b5cf6",
  data_analysis: "#f59e0b",
  automation: "#10b981",
  generation: "#ec4899",
  other: "#6b7280",
};

function formatPrice(p: string | null): string {
  const n = parseFloat(p ?? "0");
  if (n === 0) return "Free";
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function supportsListingUrlAndImages(schema: Record<string, unknown> | null) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const hasImages = fields.some((field) => {
    if (!field || typeof field !== "object") return false;
    const typedField = field as { name?: unknown; type?: unknown };
    return typedField.name === "images" && typedField.type === "file";
  });
  const hasUrl = fields.some((field) => {
    if (!field || typeof field !== "object") return false;
    const typedField = field as { name?: unknown; type?: unknown };
    return typedField.name === "url" && typedField.type === "url";
  });
  return hasImages && hasUrl;
}

// ── Schema viewer ──────────────────────────────────────────────────────────

function SchemaBlock({ schema }: { schema: Record<string, unknown> }) {
  const formatted = JSON.stringify(schema, null, 2);
  return (
    <pre
      className="code-block rounded-xl p-4 text-xs overflow-x-auto leading-relaxed"
      style={{ color: "var(--green)" }}
    >
      {formatted}
    </pre>
  );
}

// ── Stat row ───────────────────────────────────────────────────────────────

function StatRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: string;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-b-0"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="text-sm flex items-center gap-2" style={{ color: "var(--muted)" }}>
        <span>{icon}</span> {label}
      </span>
      <span
        className="text-sm font-semibold"
        style={{ fontFamily: "var(--font-mono)", color: valueColor ?? "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function ToolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = await fetchTool(slug);
  if (!tool) notFound();
  const toolDocs = await fetchToolDocs(slug);

  const catColor = CAT_COLORS[tool.category] ?? "#6b7280";
  const listingUrlAndImageTool = supportsListingUrlAndImages(tool.input_schema as Record<string, unknown> | null);
  const isConverterTool = Boolean(tool.api_endpoint?.includes("/api/tools/"));
  const inputSchemaMeta = tool.input_schema as Record<string, unknown> | null;
  const isQaCertified = Boolean(inputSchemaMeta?.qa_certified);
  const qaAvgMs = inputSchemaMeta?.qa_avg_ms as number | undefined;
  const isPendingReview = inputSchemaMeta?.review_status === "pending_review";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {isPendingReview && (
        <div style={{
          background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.25)",
          padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⏳</span>
            <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
              Pending review — not yet visible on the marketplace
            </span>
          </div>
          <a
            href="/approver"
            style={{
              fontSize: 12, fontFamily: "var(--font-mono)", padding: "4px 12px", borderRadius: 6,
              border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b", textDecoration: "none",
            }}
          >
            Review now →
          </a>
        </div>
      )}

      {/* ── Breadcrumb nav ──────────────────────────────────────────────── */}
      <nav
        className="border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-2 text-xs"
          style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
        >
          <Link href="/marketplace" className="hover:text-[var(--blue)] transition-colors"
            style={{ color: "var(--faint)" }}
          >
            marketplace
          </Link>
          <span>/</span>
          <span style={{ color: "var(--muted)" }}>{tool.slug}</span>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <header
        className="border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="animate-fade-up">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md mb-4"
              style={{
                background: `${catColor}15`,
                color: catColor,
                border: `1px solid ${catColor}35`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor }} />
              {tool.category.replace(/_/g, " ")}
            </span>
          </div>

          <h1
            className="text-4xl sm:text-5xl font-bold leading-tight mb-3 animate-fade-up delay-50"
            style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
          >
            {tool.name}
          </h1>
          <p
            className="text-lg mb-6 animate-fade-up delay-100"
            style={{ color: "var(--muted)", maxWidth: "600px" }}
          >
            {tool.tagline}
          </p>

          {/* Seller */}
          <div className="flex items-center gap-2.5 animate-fade-up delay-150">
            <span className="text-sm" style={{ color: "var(--faint)" }}>by</span>
            {tool.seller.avatar_url ? (
              <img
                src={tool.seller.avatar_url}
                alt=""
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{ background: `${catColor}25`, color: catColor }}
              >
                {(tool.seller.display_name ?? "?")[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {tool.seller.display_name}
            </span>
            {tool.github_url && (
              <a
                href={tool.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-xs border rounded-md px-2.5 py-1 transition-all hover:border-[var(--border-h)]"
                style={{
                  color: "var(--muted)",
                  borderColor: "var(--border)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                GitHub ↗
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-10">

            {/* Description */}
            <section className="animate-fade-up delay-200">
              <h2
                className="text-xs font-mono uppercase tracking-widest mb-4"
                style={{ color: "var(--faint)" }}
              >
                About
              </h2>
              <div
                className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--muted)" }}
              >
                {tool.description}
              </div>
              {listingUrlAndImageTool ? (
                <div
                  className="mt-5 rounded-2xl border px-4 py-4 text-sm leading-6"
                  style={{
                    background: "rgba(245, 158, 11, 0.08)",
                    borderColor: "rgba(245, 158, 11, 0.2)",
                    color: "var(--text)",
                  }}
                >
                  This tool accepts either a property listing URL or direct photo uploads. Listing sites like Zillow
                  can block automated scraping in production, so uploading photos is the most reliable path if a URL
                  request is rejected.
                </div>
              ) : null}
            </section>

            {/* Input / Output Schema */}
            {(tool.input_schema || tool.output_schema) && (
              <section className="animate-fade-up delay-250">
                <h2
                  className="text-xs font-mono uppercase tracking-widest mb-5"
                  style={{ color: "var(--faint)" }}
                >
                  API Contract
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {tool.input_schema && (
                    <div>
                      <p className="text-xs font-mono mb-2" style={{ color: "var(--blue)" }}>
                        → Input schema
                      </p>
                      <SchemaBlock schema={tool.input_schema as Record<string, unknown>} />
                    </div>
                  )}
                  {tool.output_schema && (
                    <div>
                      <p className="text-xs font-mono mb-2" style={{ color: "var(--green)" }}>
                        ← Output schema
                      </p>
                      <SchemaBlock schema={tool.output_schema as Record<string, unknown>} />
                    </div>
                  )}
                </div>
              </section>
            )}

            {toolDocs && <ToolDocs docs={toolDocs} />}

            {tool.documentation && (
              <section className="animate-fade-up">
                <h2
                  className="text-xs font-mono uppercase tracking-widest mb-4"
                  style={{ color: "var(--faint)" }}
                >
                  Seller Notes
                </h2>
                <div
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: "var(--muted)" }}
                >
                  {tool.documentation}
                </div>
              </section>
            )}
          </div>

          {/* ── Right column ────────────────────────────────────────────── */}
          <aside className="space-y-4">
            {/* Pricing card */}
            <div
              className="rounded-xl border p-6 sticky top-20 animate-fade-up delay-100 space-y-5"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div>
                <div
                  className="text-3xl font-bold mb-1"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}
                >
                  {formatPrice(tool.price_per_request)}
                </div>
                <div className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}>
                  per request
                </div>
              </div>

              {isQaCertified && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)",
                  borderRadius: 8, padding: "8px 12px",
                }}>
                  <span style={{ fontSize: 14, color: "var(--green)" }}>✓</span>
                  <div>
                    <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--green)", fontWeight: 700 }}>
                      QA Certified
                    </div>
                    {qaAvgMs && (
                      <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--faint)" }}>
                        {qaAvgMs}ms avg · AI-verified demo
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CTA buttons */}
              <div className="space-y-2.5">
                {(tool.input_type || tool.input_schema) && tool.output_type && (
                  <a
                    href="#demo"
                    className="flex items-center justify-center gap-2 w-full rounded-xl py-3 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{ background: "var(--blue)", color: "#fff" }}
                  >
                    Try Demo
                    <span>↓</span>
                  </a>
                )}
                <Link
                  href="/dashboard"
                  className="flex items-center justify-center gap-2 w-full rounded-xl py-3 text-sm font-medium border transition-all hover:border-[var(--border-h)]"
                  style={{
                    background: "transparent",
                    borderColor: "var(--border)",
                    color: "var(--muted)",
                  }}
                >
                  Get API Key
                  <span>→</span>
                </Link>
              </div>

              {/* Stats */}
              <div className="pt-2">
                <p
                  className="text-xs font-mono uppercase tracking-widest mb-2"
                  style={{ color: "var(--faint)" }}
                >
                  Performance
                </p>
                {tool.uptime_percentage && (
                  <StatRow
                    icon="●"
                    label="Uptime"
                    value={`${parseFloat(tool.uptime_percentage).toFixed(1)}%`}
                    valueColor="var(--green)"
                  />
                )}
                <StatRow
                  icon="⚡"
                  label="Avg latency"
                  value={
                    tool.avg_response_time_ms != null
                      ? `${tool.avg_response_time_ms}ms`
                      : "—"
                  }
                />
                <StatRow
                  icon="↗"
                  label="Total requests"
                  value={formatCount(tool.total_requests)}
                />
                <StatRow
                  icon="◈"
                  label="Input"
                  value={tool.input_type ?? "—"}
                />
                <StatRow
                  icon="◇"
                  label="Output"
                  value={tool.output_type ?? "—"}
                />
              </div>

              {/* Ownership badge */}
              <div
                className="rounded-lg px-3 py-2.5 flex items-center justify-between text-xs"
                style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}
              >
                <span style={{ color: "var(--muted)" }}>Model</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                  {tool.ownership_type === "royalty" ? "Revenue share" : "One-time purchase"}
                </span>
              </div>

              {/* Live benchmark — only for converter tools with a real demo endpoint */}
              {isConverterTool && tool.api_endpoint && (
                <LiveBenchmark endpoint={tool.api_endpoint} />
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* ── Demo section ────────────────────────────────────────────────── */}
      <div id="demo">
        <div className="max-w-7xl mx-auto px-6 pb-12">
          <DemoTabs
            slug={tool.slug}
            apiPlayground={
              <DemoRunner
                toolSlug={tool.slug}
                inputType={tool.input_type}
                inputSchema={tool.input_schema}
                outputType={tool.output_type}
                demoEndpoint={tool.api_endpoint ?? undefined}
                autoRun={isConverterTool}
                mockResponse={
                  (tool.output_schema as Record<string, unknown> | null)?.example_output ?? undefined
                }
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
