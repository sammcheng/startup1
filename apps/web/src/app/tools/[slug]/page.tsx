import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { fetchConverterTool } from "@/lib/converterTools";
import { LOCAL_FALLBACK_TOOLS } from "@/lib/localFallbackTools";
import { KC_MODULES, kcModuleToTool } from "@/lib/kcMockModules";
import ToolDocs from "@/components/docs/ToolDocs";
import type { Tool } from "@/types/tool";
import type { ToolDocumentation } from "@/types/docs";
import DemoRunner from "@/components/demo/DemoRunner";
import LiveBenchmark from "@/components/demo/LiveBenchmark";
import DemoTabs from "@/components/demos/DemoTabs";

export const dynamic = "force-dynamic";

// ── Data ───────────────────────────────────────────────────────────────────

async function fetchTool(slug: string): Promise<Tool | null> {
  // 1) Live API
  try {
    return await api.get<Tool>(`/tools/${slug}`, { cache: "no-store" });
  } catch {
    // fall through
  }

  // 2) Converter service
  try {
    const converted = await fetchConverterTool(slug);
    if (converted) return converted;
  } catch {
    // fall through
  }

  // 3) The 10 kc Rotshop modules — same source the discovery page uses,
  //    so any slug a user clicks from search results resolves to a tool.
  const kc = KC_MODULES.find((m) => m.id === slug.toLowerCase());
  if (kc) return kcModuleToTool(kc);

  // 4) Hackmarket's curated fallback set
  return LOCAL_FALLBACK_TOOLS.find((t) => t.slug === slug) ?? null;
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

      {/* ── HERO — breadcrumb · category pill · name · side-by-side cards ── */}
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-7xl mx-auto px-6 pt-6 pb-8">
          {/* Breadcrumb */}
          <div
            className="flex items-center gap-2 text-xs mb-6"
            style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
          >
            <Link
              href="/marketplace"
              className="hover:text-[var(--blue)] transition-colors"
              style={{ color: "var(--faint)" }}
            >
              marketplace
            </Link>
            <span>/</span>
            <span style={{ color: "var(--muted)" }}>{tool.slug}</span>
          </div>

          {/* Category pill */}
          <div className="animate-fade-up">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md mb-3"
              style={{
                background: `${catColor}15`,
                color: catColor,
                border: `1px solid ${catColor}35`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: catColor }}
              />
              {tool.category.replace(/_/g, " ")}
            </span>
          </div>

          {/* Name + tagline */}
          <h1
            className="text-4xl sm:text-5xl font-bold leading-tight mb-2 animate-fade-up delay-50"
            style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
          >
            {tool.name}
          </h1>
          <p
            className="text-lg animate-fade-up delay-100"
            style={{ color: "var(--muted)", maxWidth: "720px" }}
          >
            {tool.tagline}
          </p>

          {/* Seller + GitHub */}
          <div className="flex items-center gap-2.5 mt-4 animate-fade-up delay-150">
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
            <span
              className="text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
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

          {/* SIDE-BY-SIDE: price card + info card */}
          <div
            className="mt-6 grid gap-4 animate-fade-up delay-200"
            style={{ gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)" }}
          >
            {/* Price + CTAs */}
            <div
              className="rounded-xl border p-5"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div
                className="flex items-baseline gap-2 mb-1"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                <span
                  className="text-3xl font-bold"
                  style={{ color: "var(--text)" }}
                >
                  {formatPrice(tool.price_per_request)}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--faint)" }}
                >
                  {tool.ownership_type === "royalty"
                    ? "per request"
                    : "one-time"}
                </span>
              </div>
              {isQaCertified && (
                <div
                  className="flex items-center gap-2 mt-3 mb-3"
                  style={{
                    background: "rgba(16,185,129,0.08)",
                    border: "1px solid rgba(16,185,129,0.25)",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--green)" }}>✓</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: "var(--green)",
                      fontWeight: 700,
                    }}
                  >
                    QA CERTIFIED
                    {qaAvgMs ? (
                      <span
                        style={{ color: "var(--faint)", marginLeft: 6, fontWeight: 500 }}
                      >
                        · {qaAvgMs}ms avg
                      </span>
                    ) : null}
                  </span>
                </div>
              )}
              <div className="space-y-2 mt-4">
                {(tool.input_type || tool.input_schema) && tool.output_type && (
                  <a
                    href="#demo"
                    className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{ background: "var(--blue)", color: "#fff" }}
                  >
                    Try Demo
                    <span>↓</span>
                  </a>
                )}
                <Link
                  href="/dashboard"
                  className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 text-sm font-medium border transition-all hover:border-[var(--border-h)]"
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
            </div>

            {/* Info card — stats + stack */}
            <div
              className="rounded-xl border p-5"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                }}
              >
                <HeroStat
                  label="Integrations"
                  value={formatCount(tool.total_requests)}
                  icon="↗"
                />
                <HeroStat
                  label="Avg latency"
                  value={
                    tool.avg_response_time_ms != null
                      ? `${tool.avg_response_time_ms}ms`
                      : "—"
                  }
                  icon="⚡"
                />
                <HeroStat
                  label="Uptime"
                  value={
                    tool.uptime_percentage
                      ? `${parseFloat(tool.uptime_percentage).toFixed(1)}%`
                      : "—"
                  }
                  valueColor="var(--green)"
                  icon="●"
                />
                <HeroStat
                  label="Model"
                  value={
                    tool.ownership_type === "royalty"
                      ? "Revenue share"
                      : "One-time"
                  }
                  icon="◈"
                />
              </div>
              <div
                className="mt-4 pt-4 border-t flex flex-wrap gap-2"
                style={{ borderColor: "var(--border)" }}
              >
                {tool.input_type && (
                  <StackPill label={`In: ${tool.input_type}`} />
                )}
                {tool.output_type && (
                  <StackPill label={`Out: ${tool.output_type}`} />
                )}
                {isConverterTool && <StackPill label="Converter-hosted" />}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── DEMO / PLAYGROUND — directly below the hero, above the fold ── */}
      <div id="demo">
        <div className="max-w-7xl mx-auto px-6 py-8">
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
                  (tool.output_schema as Record<string, unknown> | null)
                    ?.example_output ?? undefined
                }
              />
            }
          />
        </div>
      </div>

      {/* ── TECHNICAL DETAILS — for people who scrolled this far ── */}
      <section
        className="border-t"
        style={{ borderColor: "var(--border)", background: "var(--bg)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          <div className="min-w-0 space-y-10">
            {/* About */}
            <section>
              <h2
                className="text-xs font-mono uppercase tracking-widest mb-3"
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
              {listingUrlAndImageTool && (
                <div
                  className="mt-4 rounded-xl border px-4 py-3 text-sm leading-6"
                  style={{
                    background: "rgba(245, 158, 11, 0.08)",
                    borderColor: "rgba(245, 158, 11, 0.2)",
                    color: "var(--text)",
                  }}
                >
                  This tool accepts either a property listing URL or direct
                  photo uploads. Listing sites like Zillow can block automated
                  scraping in production, so uploading photos is the most
                  reliable path if a URL request is rejected.
                </div>
              )}
            </section>

            {/* I/O contract */}
            {(tool.input_schema || tool.output_schema) && (
              <section>
                <h2
                  className="text-xs font-mono uppercase tracking-widest mb-4"
                  style={{ color: "var(--faint)" }}
                >
                  API Contract
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {tool.input_schema && (
                    <div>
                      <p
                        className="text-xs font-mono mb-2"
                        style={{ color: "var(--blue)" }}
                      >
                        → Input schema
                      </p>
                      <SchemaBlock
                        schema={tool.input_schema as Record<string, unknown>}
                      />
                    </div>
                  )}
                  {tool.output_schema && (
                    <div>
                      <p
                        className="text-xs font-mono mb-2"
                        style={{ color: "var(--green)" }}
                      >
                        ← Output schema
                      </p>
                      <SchemaBlock
                        schema={tool.output_schema as Record<string, unknown>}
                      />
                    </div>
                  )}
                </div>
              </section>
            )}

            {toolDocs && <ToolDocs docs={toolDocs} />}

            {tool.documentation && (
              <section>
                <h2
                  className="text-xs font-mono uppercase tracking-widest mb-3"
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

          {/* Right rail — performance + benchmark */}
          <aside className="space-y-4">
            <div
              className="rounded-xl border p-5"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <p
                className="text-xs font-mono uppercase tracking-widest mb-3"
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
              <StatRow icon="◈" label="Input" value={tool.input_type ?? "—"} />
              <StatRow
                icon="◇"
                label="Output"
                value={tool.output_type ?? "—"}
              />
            </div>

            {isConverterTool && tool.api_endpoint && (
              <div
                className="rounded-xl border p-5"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <LiveBenchmark endpoint={tool.api_endpoint} />
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

function HeroStat({
  label,
  value,
  valueColor,
  icon,
}: {
  label: string;
  value: string;
  valueColor?: string;
  icon?: string;
}) {
  return (
    <div>
      <div
        className="text-xs font-mono uppercase tracking-wider mb-1"
        style={{ color: "var(--faint)" }}
      >
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
        {label}
      </div>
      <div
        className="text-lg font-semibold"
        style={{
          fontFamily: "var(--font-mono)",
          color: valueColor ?? "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StackPill({ label }: { label: string }) {
  return (
    <span
      className="text-xs font-mono px-2 py-1 rounded-md border"
      style={{
        background: "var(--elevated)",
        borderColor: "var(--border)",
        color: "var(--muted)",
      }}
    >
      {label}
    </span>
  );
}
