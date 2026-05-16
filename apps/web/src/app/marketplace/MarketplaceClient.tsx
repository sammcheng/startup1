"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { api, buildQuery } from "@/lib/api";
import type {
  Tool,
  ToolCategory,
  ToolFilters,
  ToolListResponse,
  SortBy,
} from "@/types/tool";

const CONVERTER_URL =
  process.env.NEXT_PUBLIC_CONVERTER_URL ?? "http://localhost:8080";

interface ConverterTool {
  id: string;
  slug: string;
  repo_url: string;
  name: string;
  language: string;
  description: string;
  endpoints: Array<{ method: string; path: string; summary: string }>;
  setup_notes: string;
  created_at: string;
}

function converterToTool(c: ConverterTool): Tool {
  return {
    id: c.id,
    seller_id: "converter",
    seller: { id: "converter", display_name: "Hackmarket Converter", avatar_url: null, username: "converter" },
    name: c.name,
    slug: c.slug,
    tagline: c.description.length > 120 ? c.description.slice(0, 117) + "…" : c.description,
    description: c.description,
    category: "automation",
    status: "live",
    ownership_type: "royalty",
    input_type: "json",
    output_type: "json",
    input_schema: null,
    output_schema: null,
    price_per_request: null,
    demo_url: null,
    api_endpoint: null,
    docker_image_uri: null,
    github_url: c.repo_url,
    documentation: null,
    avg_response_time_ms: null,
    total_requests: 0,
    uptime_percentage: null,
    is_featured: false,
    view_count: 0,
    created_at: c.created_at,
    updated_at: c.created_at,
  };
}

async function fetchFromConverter(limit: number, offset: number): Promise<ToolListResponse> {
  const res = await fetch(`${CONVERTER_URL}/api/tools?limit=${limit}&offset=${offset}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Converter unavailable");
  const data = (await res.json()) as { tools: ConverterTool[]; total: number };
  return {
    items: data.tools.map(converterToTool),
    total: data.total,
    page: Math.floor(offset / limit) + 1,
    limit,
    pages: Math.ceil(data.total / limit),
  };
}

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES: { value: ToolCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "nlp", label: "NLP" },
  { value: "computer_vision", label: "Computer Vision" },
  { value: "data_analysis", label: "Data Analysis" },
  { value: "automation", label: "Automation" },
  { value: "generation", label: "Generation" },
  { value: "other", label: "Other" },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Most Popular" },
  { value: "price_low", label: "Price: Low → High" },
  { value: "price_high", label: "Price: High → Low" },
];

const CAT_COLORS: Record<string, string> = {
  nlp: "#3b82f6",
  computer_vision: "#8b5cf6",
  data_analysis: "#f59e0b",
  automation: "#10b981",
  generation: "#ec4899",
  other: "#6b7280",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatPrice(p: string | null): string {
  const n = parseFloat(p ?? "0");
  if (n === 0) return "Free";
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ToolCard({ tool, index }: { tool: Tool; index: number }) {
  const color = CAT_COLORS[tool.category] ?? "#6b7280";
  const delayClass = `delay-${Math.min(index * 50, 300)}`;

  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={`animate-fade-up ${delayClass} group block`}
    >
      <article
        className="relative h-full rounded-xl border transition-all duration-200 overflow-hidden"
        style={{
          background: "var(--card)",
          borderColor: "var(--border)",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.borderColor = `${color}55`;
          el.style.boxShadow = `0 0 24px ${color}0a, inset 0 0 0 1px ${color}22`;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.borderColor = "var(--border)";
          el.style.boxShadow = "none";
        }}
      >
        {/* Top accent line */}
        <div
          className="absolute top-0 left-0 right-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
        />

        <div className="p-5 flex flex-col h-full">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md"
              style={{
                background: `${color}15`,
                color,
                border: `1px solid ${color}30`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: color }}
              />
              {tool.category.replace(/_/g, " ")}
            </span>
            {tool.is_featured && (
              <span className="text-xs font-mono" style={{ color: "var(--yellow)" }}>
                ★
              </span>
            )}
          </div>

          {/* Name & tagline */}
          <h3
            className="font-display font-semibold text-base leading-snug mb-1.5 group-hover:text-white transition-colors"
            style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}
          >
            {tool.name}
          </h3>
          <p
            className="text-sm leading-relaxed line-clamp-2 mb-5 flex-1"
            style={{ color: "var(--muted)" }}
          >
            {tool.tagline}
          </p>

          {/* Stats */}
          <div
            className="border-t pt-4 mb-4 grid grid-cols-3 gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <div>
              <div
                className="text-sm font-semibold"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}
              >
                {formatPrice(tool.price_per_request)}
              </div>
              <div
                className="text-xs mt-0.5"
                style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
              >
                /req
              </div>
            </div>

            <div>
              <div
                className="text-sm font-semibold"
                style={{ fontFamily: "var(--font-mono)", color: "var(--green)" }}
              >
                {tool.avg_response_time_ms != null
                  ? `${tool.avg_response_time_ms}ms`
                  : "—"}
              </div>
              <div
                className="text-xs mt-0.5"
                style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
              >
                latency
              </div>
            </div>

            <div>
              <div
                className="text-sm font-semibold"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}
              >
                {formatCount(tool.total_requests)}
              </div>
              <div
                className="text-xs mt-0.5"
                style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
              >
                calls
              </div>
            </div>
          </div>

          {/* Seller */}
          <div className="flex items-center gap-2">
            {tool.seller.avatar_url ? (
              <img
                src={tool.seller.avatar_url}
                alt=""
                className="w-5 h-5 rounded-full object-cover border"
                style={{ borderColor: "var(--border)" }}
              />
            ) : (
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{
                  background: `${color}25`,
                  color,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {tool.seller.display_name[0]?.toUpperCase()}
              </div>
            )}
            <span className="text-xs truncate" style={{ color: "var(--muted)" }}>
              {tool.seller.display_name}
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div
      className="rounded-xl border p-5 h-52"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="animate-shimmer h-5 w-24 rounded-md mb-4" />
      <div className="animate-shimmer h-5 w-3/4 rounded mb-2" />
      <div className="animate-shimmer h-4 w-full rounded mb-1" />
      <div className="animate-shimmer h-4 w-2/3 rounded mb-5" />
      <div
        className="border-t pt-4 flex gap-6"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="animate-shimmer h-4 w-14 rounded" />
        <div className="animate-shimmer h-4 w-14 rounded" />
        <div className="animate-shimmer h-4 w-14 rounded" />
      </div>
    </div>
  );
}

function Pagination({
  page,
  pages,
  total,
  limit,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  if (pages <= 1) return null;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between mt-12">
      <span className="text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}>
        {start}–{end} of {total} tools
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg text-sm border transition-all disabled:opacity-30"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          ←
        </button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
          const n = i + 1;
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              className="w-8 h-8 rounded-lg text-sm border transition-all"
              style={{
                background: n === page ? "var(--blue)" : "var(--card)",
                borderColor: n === page ? "var(--blue)" : "var(--border)",
                color: n === page ? "#fff" : "var(--muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {n}
            </button>
          );
        })}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= pages}
          className="px-3 py-1.5 rounded-lg text-sm border transition-all disabled:opacity-30"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          →
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function MarketplaceClient({
  initialData,
  initialFetchFailed = false,
}: {
  initialData: ToolListResponse | null;
  initialFetchFailed?: boolean;
}) {
  const [data, setData] = useState<ToolListResponse | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ToolCategory | "all">("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [page, setPage] = useState(1);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchTools = useCallback(
    async (q: string, cat: ToolCategory | "all", sort: SortBy, pg: number) => {
      setLoading(true);
      setError(null);
      try {
        const filters: Record<string, unknown> = { sort_by: sort, page: pg, limit: 20 };
        if (q) filters.search = q;
        if (cat !== "all") filters.category = cat;

        try {
          const result = await api.get<ToolListResponse>(`/tools${buildQuery(filters)}`);
          setData(result);
        } catch {
          const result = await fetchFromConverter(20, (pg - 1) * 20);
          setData(result);
        }
      } catch {
        setError("Failed to load tools. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // No mount effect — server provides initialData, fetches only on user interaction
  const handleSearch = (q: string) => {
    setSearch(q);
    setPage(1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchTools(q, category, sortBy, 1), 350);
  };

  const handleCategory = (cat: ToolCategory | "all") => {
    setCategory(cat);
    setPage(1);
    void fetchTools(search, cat, sortBy, 1);
  };

  const handleSort = (sort: SortBy) => {
    setSortBy(sort);
    setPage(1);
    void fetchTools(search, category, sort, 1);
  };

  const handlePage = (p: number) => {
    setPage(p);
    void fetchTools(search, category, sortBy, p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tools = data?.items ?? [];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* ── Hero header ─────────────────────────────────────────────────── */}
      <div
        className="border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-10">
          <p
            className="text-xs font-mono uppercase tracking-widest mb-3 animate-fade-up"
            style={{ color: "var(--blue)" }}
          >
            Hackmarket
          </p>
          <h1
            className="text-4xl sm:text-5xl font-bold leading-tight mb-3 animate-fade-up delay-50"
            style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
          >
            Browse AI Tools
          </h1>
          <p
            className="text-base mb-8 animate-fade-up delay-100"
            style={{ color: "var(--muted)", maxWidth: "520px" }}
          >
            Production-ready tools with documented APIs. Integrate in minutes,
            pay only for what you use.
          </p>

          {/* Search */}
          <div className="relative max-w-xl animate-fade-up delay-150">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              style={{ color: "var(--faint)" }}
            >
              <path
                d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM13 13l-2.5-2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              placeholder="Search tools by name or description..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl text-sm border outline-none transition-all"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)",
                color: "var(--text)",
                fontFamily: "var(--font-body)",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--blue)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            />
          </div>
        </div>
      </div>

      {/* ── Filters bar ─────────────────────────────────────────────────── */}
      <div
        className="border-b sticky top-0 z-10 backdrop-blur-sm"
        style={{
          borderColor: "var(--border)",
          background: "rgba(244,243,239,.92)",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4 overflow-x-auto">
          {/* Category chips */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {CATEGORIES.map((cat) => {
              const active = category === cat.value;
              const color =
                cat.value === "all" ? "var(--blue)" : (CAT_COLORS[cat.value] ?? "var(--blue)");
              return (
                <button
                  key={cat.value}
                  onClick={() => handleCategory(cat.value as ToolCategory | "all")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-all"
                  style={{
                    background: active ? `${color}18` : "transparent",
                    borderColor: active ? `${color}55` : "var(--border)",
                    color: active ? color : "var(--muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
            >
              Sort:
            </span>
            <select
              value={sortBy}
              onChange={(e) => handleSort(e.target.value as SortBy)}
              className="text-xs border rounded-lg px-3 py-1.5 outline-none appearance-none cursor-pointer"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)",
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Tool grid ───────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Status line */}
        {!loading && data && (
          <p
            className="text-xs mb-6"
            style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
          >
            {data.total} tool{data.total !== 1 ? "s" : ""} found
          </p>
        )}

        {error && (
          <div
            className="rounded-xl border p-8 text-center mb-8"
            style={{
              background: "rgba(239,68,68,0.06)",
              borderColor: "rgba(239,68,68,0.2)",
            }}
          >
            <p className="text-sm mb-4" style={{ color: "var(--red)" }}>
              {error}
            </p>
            <button
              onClick={() => void fetchTools(search, category, sortBy, page)}
              className="text-xs underline transition-colors"
              style={{ color: "var(--text)" }}
            >
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : tools.length === 0 ? (
          <div className="text-center py-24">
            <div
              className="text-5xl mb-4 opacity-20"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              ∅
            </div>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No tools match your filters.
            </p>
            <button
              onClick={() => {
                setSearch("");
                setCategory("all");
                setSortBy("newest");
                void fetchTools("", "all", "newest", 1);
              }}
              className="mt-4 text-xs underline transition-colors"
              style={{ color: "var(--blue)" }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tools.map((tool, i) => (
              <ToolCard key={tool.id} tool={tool} index={i} />
            ))}
          </div>
        )}

        {data && (
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            limit={data.limit}
            onChange={handlePage}
          />
        )}
      </div>
    </div>
  );
}
