"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, buildQuery } from "@/lib/api";
import { tokenize, matchTools, segmentsToText } from "@/lib/nlpSearch";
import type { Segment, ScoredTool } from "@/lib/nlpSearch";
import Composer from "@/components/ui/Composer";
import type { Tool, ToolCategory, ToolListResponse, SortBy } from "@/types/tool";
import { ALLOW_CONVERTER_CATALOG_FALLBACK, CONVERTER_URL } from "@/lib/env";
import { safeCssImageUrl } from "@/lib/safe-url";
import { getToolPriceDisplay } from "@/lib/tool-pricing";

// ── Converter adapter ──────────────────────────────────────────────────────

interface ConverterEndpoint {
  method: string; path: string; summary: string;
  request_body?: Record<string, string>;
  response_example?: Record<string, unknown>;
}

interface ConverterTool {
  id: string; slug: string; repo_url: string; name: string;
  language: string; description: string;
  endpoints: ConverterEndpoint[];
  setup_notes: string; created_at: string;
}

function categoryFromDescription(lang: string, desc: string): Tool["category"] {
  const d = desc.toLowerCase();
  if (d.includes("nlp") || d.includes("language model") || d.includes("text") || d.includes("sentiment") || d.includes("summariz")) return "nlp";
  if (d.includes("image") || d.includes("vision") || d.includes("object detect") || d.includes("ocr")) return "computer_vision";
  if (d.includes("data") || d.includes("analytics") || d.includes("forecast") || d.includes("ml") || d.includes("machine learn")) return "data_analysis";
  if (d.includes("generat") || d.includes("diffusion") || d.includes("music") || d.includes("art")) return "generation";
  return "automation";
}

function buildInputSchema(endpoints: ConverterEndpoint[]): Record<string, unknown> | null {
  const first = endpoints[0];
  if (!first?.request_body || Object.keys(first.request_body).length === 0) return null;
  return {
    fields: Object.entries(first.request_body).map(([name, typeDesc]) => ({
      name,
      type: typeDesc.toLowerCase().includes("file") ? "file"
            : typeDesc.toLowerCase().includes("url") ? "url"
            : typeDesc.toLowerCase().includes("number") || typeDesc.toLowerCase().includes("int") ? "number"
            : "string",
      label: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      placeholder: typeDesc.split("—")[0]?.split("–")[0]?.trim() ?? name,
      required: true,
    })),
  };
}

function converterToTool(c: ConverterTool): Tool {
  const inputSchema = buildInputSchema(c.endpoints);
  const firstResponse = c.endpoints[0]?.response_example ?? null;
  return {
    id: c.id, seller_id: "converter",
    seller: { id: "converter", display_name: c.name, avatar_url: null, username: c.slug },
    name: c.name, slug: c.slug,
    tagline: c.description.length > 120 ? c.description.slice(0, 117) + "…" : c.description,
    description: c.description,
    category: categoryFromDescription(c.language, c.description),
    status: "draft", ownership_type: "royalty",
    input_type: inputSchema ? "json" : "text", output_type: "json",
    input_schema: inputSchema,
    output_schema: firstResponse ? { example_output: firstResponse } : null,
    price_per_request: null, one_time_price: null, demo_url: null,
    api_endpoint: null,
    docker_image_uri: null, github_url: c.repo_url,
    documentation: c.endpoints.length > 0
      ? `## Endpoints\n\n${c.endpoints.map(ep => `### ${ep.method} ${ep.path}\n${ep.summary}`).join("\n\n")}`
      : null,
    avg_response_time_ms: null, total_requests: 0, uptime_percentage: null,
    is_featured: false, view_count: 0, created_at: c.created_at, updated_at: c.created_at,
  };
}

async function fetchFromConverter(limit: number, offset: number): Promise<ToolListResponse> {
  if (!ALLOW_CONVERTER_CATALOG_FALLBACK) {
    throw new Error("Converter catalog fallback is disabled.");
  }
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

const EXAMPLES = [
  "summarize long documents and extract key points automatically",
  "detect objects in uploaded product photos using computer vision",
  "build an automated data pipeline with ML forecasting and anomaly detection",
];

const THINK_STEPS = [
  "Understanding your query...",
  "Scanning the catalog...",
  "Scoring integration fit...",
  "Ranking results...",
];

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
  nlp: "#3b82f6", computer_vision: "#8b5cf6", data_analysis: "#f59e0b",
  automation: "#10b981", generation: "#ec4899", other: "#6b7280",
};

const CATEGORY_VISUALS: Record<string, { glyph: string; label: string; accent: string }> = {
  nlp: { glyph: "Aa", label: "Text AI", accent: "#60a5fa" },
  computer_vision: { glyph: "◉", label: "Vision", accent: "#a78bfa" },
  data_analysis: { glyph: "▥", label: "Data", accent: "#fbbf24" },
  automation: { glyph: "↯", label: "Workflow", accent: "#34d399" },
  generation: { glyph: "✦", label: "Generate", accent: "#f472b6" },
  other: { glyph: "API", label: "Tool", accent: "#94a3b8" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function cardPattern(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  }
  return `${18 + (hash % 34)}px ${16 + ((hash * 7) % 32)}px`;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function ArrowLeft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}
function CheckIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}
function SparkleIcon({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  );
}
function XIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
// ── Browse sub-components ──────────────────────────────────────────────────

function BrowseCard({ tool, index }: { tool: Tool; index: number }) {
  const color = CAT_COLORS[tool.category] ?? "#6b7280";
  const visual = CATEGORY_VISUALS[tool.category] ?? CATEGORY_VISUALS.other;
  const price = getToolPriceDisplay(tool);
  const sellerAvatarBackgroundImage = safeCssImageUrl(tool.seller.avatar_url);
  const patternPosition = cardPattern(tool.slug);
  return (
    <Link href={`/tools/${tool.slug}`} className="group block h-full">
      <article
        className="relative h-full rounded-xl border transition-all duration-200 overflow-hidden flex flex-col"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.borderColor = `${color}55`;
          el.style.boxShadow = `0 18px 45px ${color}16, inset 0 0 0 1px ${color}22`;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.borderColor = "var(--border)";
          el.style.boxShadow = "none";
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
        <div
          aria-hidden="true"
          className="relative h-32 overflow-hidden"
          style={{
            background:
              `radial-gradient(circle at ${patternPosition}, ${visual.accent}66, transparent 34%), ` +
              `linear-gradient(135deg, ${color}24 0%, rgba(255,255,255,0.04) 48%, ${visual.accent}18 100%)`,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                `linear-gradient(90deg, ${color}22 1px, transparent 1px), ` +
                `linear-gradient(0deg, ${color}18 1px, transparent 1px)`,
              backgroundSize: "26px 26px",
              maskImage: "linear-gradient(135deg, black, transparent 78%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 18,
              top: 18,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.16)",
              color: "var(--text)",
              backdropFilter: "blur(10px)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
            {visual.label}
          </div>
          <div
            style={{
              position: "absolute",
              right: 18,
              bottom: 14,
              width: 72,
              height: 72,
              borderRadius: 24,
              display: "grid",
              placeItems: "center",
              background: `linear-gradient(135deg, ${color}, ${visual.accent})`,
              color: "#fff",
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: visual.glyph.length > 2 ? 18 : 28,
              boxShadow: `0 16px 34px ${color}40`,
              transform: `rotate(${index % 2 === 0 ? "-3deg" : "3deg"})`,
            }}
          >
            {visual.glyph}
          </div>
        </div>
        <div className="p-5 flex flex-1 flex-col">
          <div className="flex items-start justify-between gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md"
              style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              {tool.category.replace(/_/g, " ")}
            </span>
            {tool.is_featured && <span className="text-xs font-mono" style={{ color: "var(--yellow)" }}>★</span>}
          </div>
          <h3 className="font-display font-semibold text-base leading-snug mb-1.5 group-hover:text-white transition-colors"
            style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}>
            {tool.name}
          </h3>
          <p className="text-sm leading-relaxed line-clamp-2 mb-5 flex-1" style={{ color: "var(--muted)" }}>
            {tool.tagline}
          </p>
          <div className="border-t pt-4 mb-4 grid grid-cols-3 gap-2" style={{ borderColor: "var(--border)" }}>
            <div>
              <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{price.formatted}</div>
              <div className="text-xs mt-0.5" style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}>{price.suffix}</div>
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--green)" }}>
                {tool.avg_response_time_ms != null ? `${tool.avg_response_time_ms}ms` : "—"}
              </div>
              <div className="text-xs mt-0.5" style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}>latency</div>
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{formatCount(tool.total_requests)}</div>
              <div className="text-xs mt-0.5" style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}>calls</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sellerAvatarBackgroundImage ? (
              <span
                aria-hidden="true"
                className="w-5 h-5 rounded-full border flex-shrink-0"
                style={{
                  backgroundImage: sellerAvatarBackgroundImage,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                  borderColor: "var(--border)",
                }}
              />
            ) : (
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{ background: `${color}25`, color, fontFamily: "var(--font-mono)" }}>
                {tool.seller.display_name[0]?.toUpperCase()}
              </div>
            )}
            <span className="text-xs truncate" style={{ color: "var(--muted)" }}>{tool.seller.display_name}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="animate-shimmer h-32 w-full" />
      <div className="p-5">
        <div className="animate-shimmer h-5 w-24 rounded-md mb-4" />
        <div className="animate-shimmer h-5 w-3/4 rounded mb-2" />
        <div className="animate-shimmer h-4 w-full rounded mb-1" />
        <div className="animate-shimmer h-4 w-2/3 rounded mb-5" />
        <div className="border-t pt-4 flex gap-6" style={{ borderColor: "var(--border)" }}>
          <div className="animate-shimmer h-4 w-14 rounded" />
          <div className="animate-shimmer h-4 w-14 rounded" />
          <div className="animate-shimmer h-4 w-14 rounded" />
        </div>
      </div>
    </div>
  );
}

function Pagination({ page, pages, total, limit, onChange }: {
  page: number; pages: number; total: number; limit: number; onChange: (p: number) => void;
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
        <button onClick={() => onChange(page - 1)} disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg text-sm border transition-all disabled:opacity-30"
          style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>←</button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
          const n = i + 1;
          return (
            <button key={n} onClick={() => onChange(n)} className="w-8 h-8 rounded-lg text-sm border transition-all"
              style={{ background: n === page ? "var(--blue)" : "var(--card)", borderColor: n === page ? "var(--blue)" : "var(--border)", color: n === page ? "#fff" : "var(--muted)", fontFamily: "var(--font-mono)" }}>
              {n}
            </button>
          );
        })}
        <button onClick={() => onChange(page + 1)} disabled={page >= pages}
          className="px-3 py-1.5 rounded-lg text-sm border transition-all disabled:opacity-30"
          style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>→</button>
      </div>
    </div>
  );
}

// ── ResultCard (KC's exact layout, adapted for Tool data) ──────────────────

function ResultCard({ row, delay, onClick }: { row: ScoredTool; delay: number; onClick: () => void }) {
  const { tool, fit } = row;
  const price = getToolPriceDisplay(tool);
  return (
    <button className="v3-result-card" style={{ animationDelay: `${delay}ms` }} onClick={onClick}>
      <div className="v3-result-main">
        <div className="v3-result-head">
          <div className="v3-result-name">{tool.name}</div>
          <span className="pill pill-primary">{tool.category.replace(/_/g, " ")}</span>
          <span className="pill pill-good"><CheckIcon size={11} /> Verified</span>
        </div>
        <div className="v3-result-desc">{tool.tagline}</div>
        {fit && (
          <div className="v3-result-fit">
            <span className="icon"><SparkleIcon size={14} color="var(--kc-primary)" /></span>
            <span>{fit}</span>
          </div>
        )}
        <div className="v3-result-pills">
          <span className="pill pill-line">{tool.category.replace(/_/g, " ")}</span>
          {tool.ownership_type && <span className="pill pill-line">{tool.ownership_type}</span>}
        </div>
      </div>
      <div className="v3-result-side">
        <div className="v3-result-price">{price.formatted}</div>
        <div className="v3-result-meta">
          <span>{price.suffix} · {formatCount(tool.total_requests)} calls</span>
        </div>
        <div className="v3-result-chev"><ArrowRight size={14} /></div>
      </div>
    </button>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

type Phase = "input" | "thinking" | "results";

export default function MarketplaceClient({
  initialData,
  initialFetchFailed = false,
}: {
  initialData: ToolListResponse | null;
  initialFetchFailed?: boolean;
}) {
  // Browse state
  const [data, setData] = useState<ToolListResponse | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialFetchFailed ? "The live marketplace catalog is unavailable right now." : null,
  );
  const [category, setCategory] = useState<ToolCategory | "all">("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [page, setPage] = useState(1);

  // Discovery state
  const [phase, setPhase] = useState<Phase>("input");
  const [composerSegments, setComposerSegments] = useState<Segment[] | null>(null);
  const [submittedSegments, setSubmittedSegments] = useState<Segment[]>([]);
  const [step, setStep] = useState(-1);
  const [matched, setMatched] = useState<ScoredTool[]>([]);
  const [apiReady, setApiReady] = useState(false);

  // Live preview that updates as the user types, backed by the live API.
  // Caps the dropdown at MAX_DROPDOWN matches; surplus rolls into a "See all"
  // affordance that submits the query through the full thinking + results flow.
  const MAX_DROPDOWN = 2;
  const [livePreview, setLivePreview] = useState<ScoredTool[]>([]);
  const [livePreviewTotal, setLivePreviewTotal] = useState(0);
  const [liveQuery, setLiveQuery] = useState("");
  const livePreviewRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleLiveChange = useCallback((text: string) => {
    clearTimeout(livePreviewRef.current);
    const q = text.trim();
    setLiveQuery(q);
    if (q.length < 2) {
      setLivePreview([]);
      setLivePreviewTotal(0);
      return;
    }
    livePreviewRef.current = setTimeout(() => {
      void (async () => {
        try {
          const discoverResp = await api.post<{
            matches: Array<{
              tool: Tool;
              fit_line: string;
              match_score: number;
              matched_keywords: string[];
            }>;
          }>("/tools/discover", { query: q, limit: MAX_DROPDOWN });
          setLivePreviewTotal(discoverResp.matches.length);
          setLivePreview(
            discoverResp.matches.map((match) => ({
              tool: match.tool,
              score: match.match_score,
              hits: match.matched_keywords,
              fit: match.fit_line,
            })),
          );
        } catch {
          setLivePreview([]);
          setLivePreviewTotal(0);
        }
      })();
    }, 120);
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Drive thinking animation — gate final transition on apiReady
  useEffect(() => {
    if (phase !== "thinking") return;
    if (step >= THINK_STEPS.length) {
      if (!apiReady) return;
      const tt = setTimeout(() => setPhase("results"), 280);
      return () => clearTimeout(tt);
    }
    const tt = setTimeout(() => setStep(step + 1), 580);
    return () => clearTimeout(tt);
  }, [phase, step, apiReady]);

  async function fetchAndMatch(segs: Segment[]): Promise<void> {
    const plainText = segmentsToText(segs).trim();

    let verified: ScoredTool[] = [];
    try {
      const discoverResp = await api.post<{
        matches: Array<{
          tool: Tool;
          fit_line: string;
          match_score: number;
          matched_keywords: string[];
        }>;
        query: string;
      }>("/tools/discover", { query: plainText, limit: 12 });

      if (discoverResp.matches.length > 0) {
        const maxScore = Math.max(...discoverResp.matches.map((m) => m.match_score), 1);
        verified = discoverResp.matches.map((m) => ({
          tool: m.tool,
          score: Math.round((m.match_score / maxScore) * 100),
          hits: m.matched_keywords,
          fit: m.fit_line,
        }));
      }
    } catch {
      // discover endpoint unreachable; try the live list path
    }

    if (verified.length === 0) {
      try {
        let tools: Tool[] = [];
        try {
          const result = await api.get<ToolListResponse>(
            `/tools${buildQuery({ search: plainText, limit: 100 })}`,
          );
          tools = result.items;
        } catch {
          if (!ALLOW_CONVERTER_CATALOG_FALLBACK) {
            throw new Error("Live catalog unavailable.");
          }
          const params = new URLSearchParams({ q: plainText, limit: "100" });
          const res = await fetch(`${CONVERTER_URL}/api/tools?${params}`, { cache: "no-store" });
          if (res.ok) {
            const raw = (await res.json()) as { tools: ConverterTool[] };
            tools = raw.tools.map(converterToTool);
          }
        }
        if (tools.length > 0) {
          verified = matchTools(segs, tools);
        }
      } catch {
        // leave results empty
      }
    }

    setMatched(verified);
    setApiReady(true);
  }

  function submit(segs: Segment[]) {
    if (!segs || segs.length === 0) return;
    setSubmittedSegments(segs);
    setApiReady(false);
    setStep(0);
    setPhase("thinking");
    void fetchAndMatch(segs);
  }

  function refine() {
    setComposerSegments(submittedSegments);
    setPhase("input");
    setStep(-1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startFresh() {
    setComposerSegments([]);
    setSubmittedSegments([]);
    setPhase("input");
    setStep(-1);
  }

  function pickExample(s: string) {
    const segs = tokenize(s);
    setComposerSegments(segs);
    setTimeout(() => submit(segs), 220);
  }

  // Browse fetch — API, then converter. Empty means empty.
  const fetchTools = useCallback(
    async (cat: ToolCategory | "all", sort: SortBy, pg: number) => {
      setLoading(true);
      setError(null);
      try {
        const filters: Record<string, unknown> = { sort_by: sort, page: pg, limit: 20 };
        if (cat !== "all") filters.category = cat;

        const apiResp = await api.get<ToolListResponse>(
          `/tools${buildQuery(filters)}`,
        );
        if (apiResp.items.length > 0 || !ALLOW_CONVERTER_CATALOG_FALLBACK) {
          setData(apiResp);
          return;
        }

        // Development-only converter fallback for local demos.
        try {
          const conv = await fetchFromConverter(20, (pg - 1) * 20);
          if (conv.items.length > 0) {
            setData(conv);
            return;
          }
        } catch {
          // fall through
        }

        setData({
          items: [],
          total: 0,
          page: pg,
          limit: 20,
          pages: 1,
        });
      } catch {
        setData(null);
        setError("The live marketplace catalog is unavailable right now.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleCategory = (cat: ToolCategory | "all") => { setCategory(cat); setPage(1); void fetchTools(cat, sortBy, 1); };
  const handleSort = (sort: SortBy) => { setSortBy(sort); setPage(1); void fetchTools(category, sort, 1); };
  const handlePage = (p: number) => { setPage(p); void fetchTools(category, sortBy, p); window.scrollTo({ top: 0, behavior: "smooth" }); };

  useEffect(() => {
    const debounceTimer = debounceRef.current;
    return () => clearTimeout(debounceTimer);
  }, []);

  const browseTools = data?.items ?? [];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {/* ── Discovery section (KC's exact layout) ── */}
      <main className="v2-discovery fade-in">
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 28px" }}>

          {/* INPUT phase */}
          {phase === "input" && (
            <div className="slide-in">
              <h1 style={{ fontSize: 40, marginTop: 16, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
                What are you building?
              </h1>
              <p style={{ marginTop: 8, fontSize: 14, color: "var(--muted)" }}>
                Search the live catalog, or browse the tools below.
              </p>
              <div style={{ marginTop: 16 }}>
                <Composer
                  initialSegments={composerSegments ?? undefined}
                  onSubmit={submit}
                  onChange={handleLiveChange}
                />
              </div>

              {livePreview.length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "12px 14px",
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
                  }}
                >
                  <div
                    className="v3-mono-label"
                    style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}
                  >
                    <span>Quick matches</span>
                    <span style={{ color: "var(--faint)" }}>press ↵ for full ranking</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {livePreview.map((row) => {
                      const cat = row.tool.category.replace(/_/g, " ");
                      const color = CAT_COLORS[row.tool.category] ?? "var(--blue)";
                      return (
                        <Link
                          key={row.tool.id}
                          href={`/tools/${row.tool.slug}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            textDecoration: "none",
                            background: "transparent",
                            transition: "all 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--bg)";
                            e.currentTarget.style.borderColor = "var(--ink-3, var(--muted))";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.borderColor = "var(--border)";
                          }}
                        >
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: `${color}18`,
                              color,
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              flexShrink: 0,
                            }}
                          >
                            {cat}
                          </span>
                          <span
                            style={{
                              color: "var(--text)",
                              fontWeight: 600,
                              fontSize: 13.5,
                              flexShrink: 0,
                            }}
                          >
                            {row.tool.name}
                          </span>
                          <span
                            style={{
                              color: "var(--muted)",
                              fontSize: 12.5,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            — {row.tool.tagline}
                          </span>
                          <span
                            style={{
                              marginLeft: "auto",
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: "1px dashed var(--border)",
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                              color: "var(--muted)",
                              flexShrink: 0,
                            }}
                          >
                              Live
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                  {livePreviewTotal > MAX_DROPDOWN && (
                    <button
                      onClick={() => {
                        const segs = tokenize(liveQuery);
                        submit(segs);
                      }}
                      style={{
                        marginTop: 8,
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px dashed var(--border)",
                        background: "transparent",
                        color: "var(--blue)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "center",
                      }}
                    >
                      See all {livePreviewTotal} results →
                    </button>
                  )}
                </div>
              )}

              {/* ── CATALOG — directly below the search; the user's first reach. ── */}
              <div style={{ marginTop: 28 }}>
                <div className="between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div className="v3-mono-label">AI tools · catalog</div>
                    {!loading && data && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--faint)",
                          fontFamily: "var(--font-mono)",
                          marginTop: 2,
                        }}
                      >
                        {data.total} {data.total === 1 ? "tool" : "tools"} ready to integrate
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {CATEGORIES.map((cat) => {
                      const active = category === cat.value;
                      const color = cat.value === "all" ? "var(--blue)" : (CAT_COLORS[cat.value] ?? "var(--blue)");
                      return (
                        <button key={cat.value} onClick={() => handleCategory(cat.value as ToolCategory | "all")}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-all"
                          style={{
                            background: active ? `${color}18` : "transparent",
                            borderColor: active ? `${color}55` : "var(--border)",
                            color: active ? color : "var(--muted)",
                            fontFamily: "var(--font-mono)",
                          }}>
                          {cat.label}
                        </button>
                      );
                    })}
                    <select value={sortBy} onChange={(e) => handleSort(e.target.value as SortBy)}
                      className="text-xs border rounded-lg px-3 py-1.5 outline-none appearance-none cursor-pointer"
                      style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                      {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border p-6 text-center mb-6"
                    style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)" }}>
                    <p className="text-sm mb-3" style={{ color: "var(--red)" }}>{error}</p>
                    <button onClick={() => void fetchTools(category, sortBy, page)} className="text-xs underline" style={{ color: "var(--text)" }}>Retry</button>
                  </div>
                )}
                {loading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                  </div>
                ) : browseTools.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-5xl mb-4 opacity-20" style={{ fontFamily: "var(--font-mono)" }}>∅</div>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>No tools match your filters.</p>
                    <button onClick={() => { setCategory("all"); setSortBy("newest"); void fetchTools("all", "newest", 1); }}
                      className="mt-4 text-xs underline" style={{ color: "var(--blue)" }}>Clear filters</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {browseTools.map((tool, i) => <BrowseCard key={tool.id} tool={tool} index={i} />)}
                  </div>
                )}
                {data && (
                  <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onChange={handlePage} />
                )}
              </div>

              {/* ── Examples + Sell CTA — moved BELOW the catalog ── */}
              <div className="v3-examples" style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid var(--border)" }}>
                <div className="v3-mono-label" style={{ marginBottom: 4 }}>Try a smart-search prompt</div>
                {EXAMPLES.map((s) => (
                  <button key={s} className="v3-example" onClick={() => pickExample(s)}>
                    <span className="v3-example-label">Example</span>
                    <span>{s}</span>
                    <span className="ex-arrow"><ArrowRight size={14} /></span>
                  </button>
                ))}
              </div>

              <div style={{
                marginTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px 20px", borderRadius: 14,
                background: "var(--elevated, var(--card))", border: "1px solid var(--border)",
                gap: 16, flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
                    Got a GitHub repo? Turn it into a sellable API.
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    Paste a link → we detect endpoints → you earn on every call.
                  </div>
                </div>
                <Link href="/submit" style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 18px", borderRadius: 9, background: "var(--blue)",
                  color: "#fff", fontWeight: 600, fontSize: 13, textDecoration: "none",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  Submit your build →
                </Link>
              </div>
            </div>
          )}

          {/* THINKING / RESULTS phase */}
          {(phase === "thinking" || phase === "results") && (
            <div className="v3-think-shell slide-in">
              {/* Query recap card */}
              <div className="v3-think-prompt">
                <div className="between">
                  <div className="v3-think-prompt-label">Your query</div>
                  {phase === "results" && (
                    <button className="btn-link" style={{ fontSize: 13 }} onClick={startFresh}>
                      <XIcon size={12} /> &nbsp;New search
                    </button>
                  )}
                </div>
                <div className="v3-think-prompt-body">
                  {submittedSegments.map((seg, i) => {
                    if (seg.type === "text") return <span key={i}>{seg.value}</span>;
                    return (
                      <span key={i} className="v3-tag">
                        <span className="v3-tag-cat">{seg.cat}</span>
                        <span>{seg.value}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Thinking card */}
              <div className="v3-think-card">
                <div className="v3-think-head">
                  <div className="v3-think-title">{phase === "thinking" ? "Analyzing" : "Analysis complete"}</div>
                  <div className="v3-think-count">
                    {phase === "thinking"
                      ? `${Math.min(step, THINK_STEPS.length)}/${THINK_STEPS.length}`
                      : `${THINK_STEPS.length}/${THINK_STEPS.length}`}
                  </div>
                </div>
                <div className="v3-progress">
                  <div className="v3-progress-bar" style={{
                    width: (phase === "results" ? 100 : (Math.min(step, THINK_STEPS.length) / THINK_STEPS.length) * 100) + "%",
                  }} />
                </div>
                <div>
                  {THINK_STEPS.map((s, i) => {
                    const done = phase === "results" || i < step;
                    const active = phase === "thinking" && i === step;
                    return (
                      <div key={s} className={`v3-think-step${active ? " active" : ""}${done ? " done" : ""}`}>
                        <div className="step-icon">
                          {done
                            ? <span className="step-check"><CheckIcon size={11} /></span>
                            : active ? <span className="spinner" />
                            : <span className="step-pending" />}
                        </div>
                        <div className="step-text">{s}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Results */}
              {phase === "results" && (
                <div>
                  <div className="between" style={{ padding: "20px 4px 8px" }}>
                    <div className="v3-mono-label">
                      {matched.length} {matched.length === 1 ? "tool" : "tools"} matched
                    </div>
                    <div className="v3-mono-label">Ranked by integration fit</div>
                  </div>
                  {matched.length > 0 ? (
                    <div className="v3-results">
                      {matched.map((row, i) => (
                        <ResultCard
                          key={row.tool.id}
                          row={row}
                          delay={i * 110}
                          onClick={() => window.location.href = `/tools/${row.tool.slug}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 28,
                        textAlign: "center",
                        color: "var(--muted)",
                        background: "var(--card)",
                      }}
                    >
                      No live tools matched this query yet.
                    </div>
                  )}
                  <div style={{
                    marginTop: 28, padding: 22, border: "1px dashed var(--line)", borderRadius: 14,
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
                    background: "var(--bg-card)",
                  }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16 }}>Not quite right?</div>
                      <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>Edit your query and we'll re-rank.</div>
                    </div>
                    <button className="btn btn-ghost" onClick={refine}>
                      Refine search <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
