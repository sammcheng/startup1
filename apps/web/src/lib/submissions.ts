"use client";

// Client-side submission store backed by localStorage.
// Both the creator-facing status tracker (/submit/[id]/status) and the
// approver dashboard (/approver) read from this store.
//
// Three lifecycle stages drive the approver UI:
//   STAGE A — testing      (automated testing live; no score yet)
//   STAGE B — manual_review (testing complete, awaiting human sign-off)
//   STAGE C — listed       (approved, live on the marketplace + monitored)
//
// Pre-seeded with 2 in each stage so the approver dashboard is populated
// out of the box.

const STORAGE_KEY = "hackmarket.submissions.v2";
const LEGACY_STORAGE_KEYS = ["hackmarket.submissions.v1"];

export type SubmissionStage =
  | "submitted"
  | "testing" // Stage A: automated testing in progress
  | "manual_review" // Stage B: review-ready
  | "listed" // Stage C: approved and live
  | "rejected"
  | "revoked"; // listed → revoked by approver

export interface SubmissionMetrics {
  confidence: number; // 0-100
  endpoints_total: number;
  endpoints_passing: number;
  avg_response_ms: number;
  p50_response_ms: number;
  p95_response_ms: number;
  p99_response_ms: number;
  io_match_pct: number;
  security: {
    critical: number;
    medium: number;
    low: number;
  };
  docs_quality: "Good" | "Fair" | "Poor";
  test_coverage_pct: number;
  deps_total: number;
  deps_outdated: number;
  deps_vulnerable: number;
  rate_limiting: boolean;
  consistent_errors: boolean;
  rest_conventions: boolean;
  loc: number;
  files: number;
  license: string | null;
  last_commit: string; // ISO
}

export interface UserReview {
  user: string;
  rating: number; // 1-5
  comment: string;
  posted_at: string; // ISO
  /** Optional — a feature request rather than just a review. */
  is_feature_request?: boolean;
}

export interface LiveMonitoring {
  uptime_pct: number; // 0-100
  uptime_window_days: number;
  installs: number;
  api_calls_total: number;
  api_calls_7d: number;
  earnings_cents_7d: number;
  health: "healthy" | "degraded" | "outage";
  reviews: UserReview[];
  listed_at: string; // ISO
  feedback_summary?: string;
}

export interface EndpointTestResult {
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  passed: boolean;
  expected_keys: string[];
  actual_sample: Record<string, unknown>;
  failure_reason?: string;
}

export interface SubmissionRecord {
  id: string;
  name: string;
  slug: string;
  github_url: string;
  submitter_email: string;
  language: string;
  category: string; // kc-shape: "Auth" | "Payments" | etc.
  tech_stack: string[];
  description: string;
  inputs: string;
  outputs: string;
  pricing_model: "buy" | "royalty";
  price_cents: number;
  submitted_at: string; // ISO
  stage: SubmissionStage;
  metrics: SubmissionMetrics;
  endpoint_results?: EndpointTestResult[];
  reviewer_notes?: string;
  rejection_reason?: string;
  /** Populated only for stage === "listed" or "revoked". */
  live?: LiveMonitoring;
  /** When testing was kicked off, drives the auto-completion timer. */
  testing_started_at?: string;
}

// ─── Pre-seeded demo data ────────────────────────────────────────────────

function nowMinus(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function nowPlus(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function buildEndpointResults(
  category: string,
  passing: number,
  total: number,
  baseLatency: number,
): EndpointTestResult[] {
  const scenario = ENDPOINT_SCENARIOS[category] ?? ENDPOINT_SCENARIOS.Auth;
  return scenario.slice(0, total).map((s, i) => {
    const ok = i < passing;
    const latency = baseLatency + Math.round(Math.random() * 60 - 30);
    return {
      method: s.method,
      path: s.path,
      status: ok ? s.successStatus : 500,
      latency_ms: Math.max(20, latency),
      passed: ok,
      expected_keys: s.expectedKeys,
      actual_sample: ok ? s.successSample : { error: "internal_server_error" },
      failure_reason: ok ? undefined : "Response missing required keys or 5xx returned",
    };
  });
}

interface EndpointScenarioRow {
  method: string;
  path: string;
  successStatus: number;
  expectedKeys: string[];
  successSample: Record<string, unknown>;
}

const ENDPOINT_SCENARIOS: Record<string, EndpointScenarioRow[]> = {
  Auth: [
    {
      method: "POST",
      path: "/login",
      successStatus: 200,
      expectedKeys: ["token", "user", "refresh_token"],
      successSample: {
        token: "eyJhbGciOiJIUzI1NiJ9...",
        user: { id: "u_42", email: "test@example.com" },
        refresh_token: "rt_8sd92x...",
      },
    },
    {
      method: "POST",
      path: "/register",
      successStatus: 201,
      expectedKeys: ["user", "token"],
      successSample: { user: { id: "u_99", email: "new@user.com" }, token: "eyJ..." },
    },
    {
      method: "GET",
      path: "/me",
      successStatus: 200,
      expectedKeys: ["id", "email", "scopes"],
      successSample: { id: "u_42", email: "test@example.com", scopes: ["read", "write"] },
    },
    {
      method: "POST",
      path: "/logout",
      successStatus: 204,
      expectedKeys: [],
      successSample: {},
    },
  ],
  Payments: [
    {
      method: "POST",
      path: "/subscribe",
      successStatus: 200,
      expectedKeys: ["subscription_id", "status", "invoice_url"],
      successSample: { subscription_id: "sub_8a2f", status: "active", invoice_url: "https://stripe.com/i/inv_x" },
    },
    {
      method: "POST",
      path: "/charge",
      successStatus: 200,
      expectedKeys: ["charge_id", "amount", "currency"],
      successSample: { charge_id: "ch_9d2", amount: 4900, currency: "usd" },
    },
    {
      method: "GET",
      path: "/invoices",
      successStatus: 200,
      expectedKeys: ["invoices"],
      successSample: { invoices: [{ id: "inv_x", amount_due: 4900, status: "paid" }] },
    },
  ],
  Notifications: [
    {
      method: "POST",
      path: "/send",
      successStatus: 200,
      expectedKeys: ["message_id", "channels"],
      successSample: { message_id: "msg_a8x", channels: { email: "queued", push: "queued" } },
    },
    {
      method: "GET",
      path: "/status/:id",
      successStatus: 200,
      expectedKeys: ["status", "delivered_at"],
      successSample: { status: "delivered", delivered_at: "2026-05-17T12:00:00Z" },
    },
  ],
  Analytics: [
    {
      method: "POST",
      path: "/events",
      successStatus: 202,
      expectedKeys: ["accepted"],
      successSample: { accepted: 1 },
    },
    {
      method: "GET",
      path: "/rollup",
      successStatus: 200,
      expectedKeys: ["buckets"],
      successSample: { buckets: [{ ts: "2026-05-17T00:00:00Z", count: 1241, p95_ms: 120 }] },
    },
    {
      method: "POST",
      path: "/query",
      successStatus: 200,
      expectedKeys: ["rows", "schema"],
      successSample: { rows: [], schema: ["ts", "count"] },
    },
  ],
  "AI/ML": [
    {
      method: "POST",
      path: "/embed",
      successStatus: 200,
      expectedKeys: ["embeddings", "dimensions"],
      successSample: { embeddings: [[0.13, -0.04]], dimensions: 1536 },
    },
    {
      method: "POST",
      path: "/search",
      successStatus: 200,
      expectedKeys: ["matches"],
      successSample: { matches: [{ id: "doc_1", score: 0.92 }] },
    },
  ],
  DevOps: [
    {
      method: "POST",
      path: "/capture",
      successStatus: 201,
      expectedKeys: ["issue_id", "deduped"],
      successSample: { issue_id: "iss_x", deduped: false },
    },
    {
      method: "GET",
      path: "/issues",
      successStatus: 200,
      expectedKeys: ["issues"],
      successSample: { issues: [] },
    },
  ],
  "UI Components": [
    {
      method: "POST",
      path: "/submit",
      successStatus: 200,
      expectedKeys: ["valid", "errors"],
      successSample: { valid: true, errors: {} },
    },
    {
      method: "GET",
      path: "/schema",
      successStatus: 200,
      expectedKeys: ["fields"],
      successSample: { fields: [{ name: "email", type: "email" }] },
    },
  ],
  "Data Pipelines": [
    {
      method: "POST",
      path: "/ingest",
      successStatus: 202,
      expectedKeys: ["job_id", "queued"],
      successSample: { job_id: "job_1", queued: 1024 },
    },
    {
      method: "POST",
      path: "/validate",
      successStatus: 200,
      expectedKeys: ["rows_ok", "rows_rejected"],
      successSample: { rows_ok: 998, rows_rejected: 26 },
    },
    {
      method: "GET",
      path: "/report",
      successStatus: 200,
      expectedKeys: ["report"],
      successSample: { report: { ok: 998, rejected: 26 } },
    },
  ],
};

// ─── Pre-seeded MOCKS — 2 testing, 2 review-ready, 2 listed ─────────────

const MOCK_SUBMISSIONS: SubmissionRecord[] = [
  // ─ Stage A: testing in progress ─────────────────────────────────────
  {
    id: "demo-test-1",
    name: "PromptHive",
    slug: "prompthive",
    github_url: "https://github.com/hackmarket-demo/prompt-hive",
    submitter_email: "marina@labs.dev",
    language: "Python",
    category: "AI/ML",
    tech_stack: ["Python", "FastAPI", "OpenAI"],
    description:
      "Centralized prompt-library service with versioning, A/B testing, and rollback. Drop-in client SDKs for Python and Node.",
    inputs: "Template name, variables, model preferences, optional A/B variant.",
    outputs: "Rendered prompt, version metadata, evaluation hooks.",
    pricing_model: "royalty",
    price_cents: 30,
    submitted_at: nowMinus(4),
    stage: "testing",
    testing_started_at: nowMinus(0.2),
    metrics: zeroMetrics(),
  },
  {
    id: "demo-test-2",
    name: "EdgeCache",
    slug: "edgecache",
    github_url: "https://github.com/hackmarket-demo/edge-cache",
    submitter_email: "soto@stratus.app",
    language: "Go",
    category: "DevOps",
    tech_stack: ["Go", "Redis"],
    description:
      "Edge caching middleware with origin-shielded fan-out and stale-while-revalidate semantics.",
    inputs: "Cache key, TTL, optional vary headers, origin URL.",
    outputs: "Hit/miss status, cached payload, ETag.",
    pricing_model: "buy",
    price_cents: 850,
    submitted_at: nowMinus(2),
    stage: "testing",
    testing_started_at: nowMinus(0.1),
    metrics: zeroMetrics(),
  },

  // ─ Stage B: review-ready ────────────────────────────────────────────
  {
    id: "demo-review-1",
    name: "AuthForge",
    slug: "authforge",
    github_url: "https://github.com/hackmarket-demo/auth-module",
    submitter_email: "ada@hackmarket.io",
    language: "Python",
    category: "Auth",
    tech_stack: ["Python", "FastAPI", "Pydantic"],
    description:
      "Drop-in OAuth2 + magic link authentication with session management and JWT issuance.",
    inputs:
      "User credentials (email/password or OAuth token), redirect URI, requested scopes.",
    outputs: "JWT session token, user profile object, refresh token.",
    pricing_model: "buy",
    price_cents: 1200,
    submitted_at: nowMinus(140),
    stage: "manual_review",
    metrics: {
      confidence: 87,
      endpoints_total: 3,
      endpoints_passing: 3,
      avg_response_ms: 89,
      p50_response_ms: 78,
      p95_response_ms: 142,
      p99_response_ms: 198,
      io_match_pct: 100,
      security: { critical: 0, medium: 1, low: 2 },
      docs_quality: "Good",
      test_coverage_pct: 72,
      deps_total: 18,
      deps_outdated: 2,
      deps_vulnerable: 1,
      rate_limiting: false,
      consistent_errors: true,
      rest_conventions: true,
      loc: 1842,
      files: 24,
      license: "MIT",
      last_commit: nowMinus(60 * 6),
    },
    endpoint_results: buildEndpointResults("Auth", 3, 3, 89),
  },
  {
    id: "demo-review-2",
    name: "QuickStats",
    slug: "quickstats",
    github_url: "https://github.com/hackmarket-demo/quick-stats",
    submitter_email: "dev@startup.co",
    language: "Node.js",
    category: "Analytics",
    tech_stack: ["Node.js", "Express"],
    description:
      "Lightweight analytics aggregation service. Takes raw event streams and emits rollups.",
    inputs: "Event stream (JSON), aggregation window, dimensions.",
    outputs: "Rollup buckets with counts, sums, p50/p95.",
    pricing_model: "royalty",
    price_cents: 35,
    submitted_at: nowMinus(28),
    stage: "manual_review",
    metrics: {
      confidence: 45,
      endpoints_total: 3,
      endpoints_passing: 1,
      avg_response_ms: 612,
      p50_response_ms: 410,
      p95_response_ms: 1240,
      p99_response_ms: 2180,
      io_match_pct: 52,
      security: { critical: 2, medium: 5, low: 8 },
      docs_quality: "Poor",
      test_coverage_pct: 12,
      deps_total: 47,
      deps_outdated: 19,
      deps_vulnerable: 6,
      rate_limiting: false,
      consistent_errors: false,
      rest_conventions: false,
      loc: 891,
      files: 12,
      license: null,
      last_commit: nowMinus(60 * 48),
    },
    endpoint_results: buildEndpointResults("Analytics", 1, 3, 612),
  },

  // ─ Stage C: listed (with live monitoring) ───────────────────────────
  {
    id: "demo-live-1",
    name: "VectorVault",
    slug: "vectorvault",
    github_url: "https://github.com/hackmarket-demo/vector-vault",
    submitter_email: "rk@vault.dev",
    language: "Python",
    category: "AI/ML",
    tech_stack: ["Python", "FAISS"],
    description:
      "Embeddings storage and similarity search with hybrid sparse-dense retrieval.",
    inputs: "Text or vectors, collection name, top-k.",
    outputs: "Ranked matches with cosine similarity scores.",
    pricing_model: "royalty",
    price_cents: 12,
    submitted_at: nowMinus(60 * 24 * 5),
    stage: "listed",
    metrics: {
      confidence: 91,
      endpoints_total: 4,
      endpoints_passing: 4,
      avg_response_ms: 64,
      p50_response_ms: 58,
      p95_response_ms: 112,
      p99_response_ms: 184,
      io_match_pct: 100,
      security: { critical: 0, medium: 0, low: 1 },
      docs_quality: "Good",
      test_coverage_pct: 84,
      deps_total: 22,
      deps_outdated: 1,
      deps_vulnerable: 0,
      rate_limiting: true,
      consistent_errors: true,
      rest_conventions: true,
      loc: 2147,
      files: 31,
      license: "MIT",
      last_commit: nowMinus(60 * 30),
    },
    endpoint_results: buildEndpointResults("AI/ML", 4, 4, 64),
    live: {
      uptime_pct: 99.94,
      uptime_window_days: 30,
      installs: 187,
      api_calls_total: 482113,
      api_calls_7d: 41208,
      earnings_cents_7d: 4945,
      health: "healthy",
      listed_at: nowMinus(60 * 24 * 5),
      feedback_summary:
        "Users praise the latency and dual-index retrieval. Two recurring requests: streaming responses for large queries, and a managed metadata filter DSL.",
      reviews: [
        {
          user: "Priya at Stitchroom",
          rating: 5,
          comment:
            "Switched from Pinecone for our RAG layer. 60ms p95 is wild — kept the same recall@10.",
          posted_at: nowMinus(60 * 16),
        },
        {
          user: "Marco @ replyforge.io",
          rating: 5,
          comment:
            "Would pay 3x what we currently do if you shipped a streaming search response.",
          posted_at: nowMinus(60 * 41),
          is_feature_request: true,
        },
        {
          user: "Lin (ZenoteAI)",
          rating: 4,
          comment:
            "Metadata filtering works but the syntax is awkward — pls support proper boolean ops.",
          posted_at: nowMinus(60 * 73),
          is_feature_request: true,
        },
        {
          user: "Devon @ Helio",
          rating: 5,
          comment: "Drop-in for our search service. Zero downtime over the last month.",
          posted_at: nowMinus(60 * 96),
        },
      ],
    },
  },
  {
    id: "demo-live-2",
    name: "PayPipe",
    slug: "paypipe",
    github_url: "https://github.com/hackmarket-demo/pay-pipe",
    submitter_email: "ana@paymints.co",
    language: "Node.js",
    category: "Payments",
    tech_stack: ["Node.js", "Express", "Stripe"],
    description:
      "Stripe subscription wrapper with usage-based metering, trial automation, and webhook fanout.",
    inputs: "Customer ID, plan, metered events, webhook destinations.",
    outputs: "Subscription state, invoice URLs, usage rollups.",
    pricing_model: "royalty",
    price_cents: 45,
    submitted_at: nowMinus(60 * 24 * 9),
    stage: "listed",
    metrics: {
      confidence: 88,
      endpoints_total: 3,
      endpoints_passing: 3,
      avg_response_ms: 162,
      p50_response_ms: 138,
      p95_response_ms: 312,
      p99_response_ms: 480,
      io_match_pct: 96,
      security: { critical: 0, medium: 1, low: 1 },
      docs_quality: "Good",
      test_coverage_pct: 68,
      deps_total: 26,
      deps_outdated: 3,
      deps_vulnerable: 0,
      rate_limiting: true,
      consistent_errors: true,
      rest_conventions: true,
      loc: 2740,
      files: 38,
      license: "MIT",
      last_commit: nowMinus(60 * 84),
    },
    endpoint_results: buildEndpointResults("Payments", 3, 3, 162),
    live: {
      uptime_pct: 99.81,
      uptime_window_days: 30,
      installs: 124,
      api_calls_total: 318422,
      api_calls_7d: 28612,
      earnings_cents_7d: 12876,
      health: "healthy",
      listed_at: nowMinus(60 * 24 * 9),
      feedback_summary:
        "Strong adoption from B2B SaaS teams. The most-requested upgrade is native support for proration-on-quantity-change.",
      reviews: [
        {
          user: "Rohan @ Plaiform",
          rating: 5,
          comment: "Replaced 800 lines of glue code. Webhook fanout alone is worth the price.",
          posted_at: nowMinus(60 * 12),
        },
        {
          user: "Stitch (NestNote)",
          rating: 4,
          comment:
            "Solid. Wish there was proration on quantity changes mid-cycle — would be perfect.",
          posted_at: nowMinus(60 * 56),
          is_feature_request: true,
        },
        {
          user: "Ade @ bandeau.dev",
          rating: 4,
          comment: "Onboarding docs are great. The trial-end webhook is the one I wired first.",
          posted_at: nowMinus(60 * 110),
        },
      ],
    },
  },
];

function zeroMetrics(): SubmissionMetrics {
  return {
    confidence: 0,
    endpoints_total: 0,
    endpoints_passing: 0,
    avg_response_ms: 0,
    p50_response_ms: 0,
    p95_response_ms: 0,
    p99_response_ms: 0,
    io_match_pct: 0,
    security: { critical: 0, medium: 0, low: 0 },
    docs_quality: "Good",
    test_coverage_pct: 0,
    deps_total: 0,
    deps_outdated: 0,
    deps_vulnerable: 0,
    rate_limiting: false,
    consistent_errors: false,
    rest_conventions: false,
    loc: 0,
    files: 0,
    license: null,
    last_commit: new Date().toISOString(),
  };
}

// ─── Storage helpers ─────────────────────────────────────────────────────

function loadAll(): SubmissionRecord[] {
  if (typeof window === "undefined") return MOCK_SUBMISSIONS;
  try {
    // Drop legacy v1 store so the new pre-seeded layout always wins.
    for (const legacy of LEGACY_STORAGE_KEYS) {
      if (window.localStorage.getItem(legacy)) {
        window.localStorage.removeItem(legacy);
      }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SUBMISSIONS));
      return MOCK_SUBMISSIONS;
    }
    const parsed = JSON.parse(raw) as SubmissionRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SUBMISSIONS));
      return MOCK_SUBMISSIONS;
    }

    // Defensive scrubs on every load:
    //   1) Strip HTML from names (READMEs sometimes ship `<p align="center">`).
    //   2) If a "testing" submission's timer has expired, refresh it so the
    //      demo Stage-A visualization is always visible at least once per visit.
    let mutated = false;
    const cleaned = parsed.map((r) => {
      const sanitized = sanitizeName(r.name);
      const next = { ...r };
      if (sanitized && sanitized !== r.name) {
        next.name = sanitized;
        mutated = true;
      }
      if (r.stage === "testing") {
        const startedAt = r.testing_started_at
          ? new Date(r.testing_started_at).getTime()
          : 0;
        const elapsed = Date.now() - startedAt;
        // If the timer has expired or never started, restart so Stage A is
        // visible. (Approve flow still moves these to manual_review properly.)
        if (!r.testing_started_at || elapsed > 30_000) {
          next.testing_started_at = new Date().toISOString();
          mutated = true;
        }
      }
      return next;
    });
    if (mutated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch {
    return MOCK_SUBMISSIONS;
  }
}

function saveAll(records: SubmissionRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage full or disabled — ignore
  }
}

export function listSubmissions(): SubmissionRecord[] {
  return loadAll().sort(
    (a, b) =>
      new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime(),
  );
}

export function getSubmission(id: string): SubmissionRecord | null {
  return loadAll().find((s) => s.id === id) ?? null;
}

export function upsertSubmission(record: SubmissionRecord): void {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === record.id);
  if (idx >= 0) {
    all[idx] = record;
  } else {
    all.unshift(record);
  }
  saveAll(all);
}

export function updateSubmission(
  id: string,
  patch: Partial<SubmissionRecord>,
): SubmissionRecord | null {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  saveAll(all);
  return all[idx];
}

export function resetSubmissions(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SUBMISSIONS));
}

// ─── ID + metrics generators for live submits ──────────────────────────

export function newSubmissionId(): string {
  return `sub_${Math.random().toString(36).slice(2, 10)}`;
}

/** Strip HTML tags + collapse whitespace. Defends against tool names that
 *  came from a README's first line, which can contain `<p align="center">`,
 *  `<br>`, image tags, etc. Used both at ingest and as a defensive render-
 *  time helper in the approver / status / tool detail views. */
export function sanitizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateMetricsForCategory(category: string): SubmissionMetrics {
  const r = (min: number, max: number) =>
    Math.round(min + Math.random() * (max - min));
  const p50 = r(50, 220);
  const p95 = p50 + r(40, 160);
  const p99 = p95 + r(40, 220);
  return {
    confidence: r(74, 92),
    endpoints_total: r(2, 5),
    endpoints_passing: 0, // caller fills
    avg_response_ms: Math.round((p50 + p95) / 2),
    p50_response_ms: p50,
    p95_response_ms: p95,
    p99_response_ms: p99,
    io_match_pct: r(85, 100),
    security: { critical: 0, medium: r(0, 2), low: r(0, 3) },
    docs_quality: r(1, 100) > 30 ? "Good" : "Fair",
    test_coverage_pct: r(35, 80),
    deps_total: r(14, 35),
    deps_outdated: r(0, 5),
    deps_vulnerable: r(0, 2),
    rate_limiting: Math.random() > 0.55,
    consistent_errors: true,
    rest_conventions: true,
    loc: r(800, 4200),
    files: r(12, 48),
    license: ["MIT", "Apache-2.0", "BSD-3-Clause"][r(0, 2)],
    last_commit: nowMinus(r(60, 60 * 72)),
  };
}

/** Promote a fresh submission from `testing` → `manual_review` with metrics. */
export function completeTesting(
  id: string,
): SubmissionRecord | null {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const record = all[idx];
  if (record.stage !== "testing") return record;
  const metrics = generateMetricsForCategory(record.category);
  metrics.endpoints_passing = metrics.endpoints_total;
  const endpoint_results = buildEndpointResults(
    record.category,
    metrics.endpoints_passing,
    metrics.endpoints_total,
    metrics.avg_response_ms,
  );
  all[idx] = {
    ...record,
    stage: "manual_review",
    metrics,
    endpoint_results,
  };
  saveAll(all);
  return all[idx];
}

/** Approve → listed; auto-populates LiveMonitoring stub. */
export function approveSubmission(id: string): SubmissionRecord | null {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const record = all[idx];
  const live: LiveMonitoring = record.live ?? {
    uptime_pct: 100,
    uptime_window_days: 1,
    installs: 0,
    api_calls_total: 0,
    api_calls_7d: 0,
    earnings_cents_7d: 0,
    health: "healthy",
    listed_at: new Date().toISOString(),
    reviews: [],
  };
  all[idx] = { ...record, stage: "listed", live };
  saveAll(all);
  return all[idx];
}

export function revokeSubmission(
  id: string,
  reason: string,
): SubmissionRecord | null {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], stage: "revoked", rejection_reason: reason };
  saveAll(all);
  return all[idx];
}

// ─── Sandbox scenarios (animated terminal lines per category) ────────────

export interface SandboxLine {
  text: string;
  indent?: number;
  style?: "neutral" | "ok" | "warn" | "err" | "header";
  delay?: number;
}

interface SandboxScenarioParts {
  endpoints: string[];
  sample_request: string;
  contract_checks: string[];
}

const SANDBOX_SCENARIOS: Record<string, SandboxScenarioParts> = {
  Auth: {
    endpoints: ["POST /login", "POST /register", "GET /me"],
    sample_request: '{"email":"test@example.com","password":"hunter2"}',
    contract_checks: ["Returns JWT token", "Response matches I/O contract"],
  },
  Payments: {
    endpoints: ["POST /subscribe", "POST /charge", "GET /invoices"],
    sample_request: '{"customer_id":"cus_8a2f","plan":"pro_monthly","metered":true}',
    contract_checks: ["Creates subscription", "Returns invoice URL"],
  },
  Notifications: {
    endpoints: ["POST /send", "GET /status/:id", "POST /templates"],
    sample_request: '{"recipient_id":"u_42","channels":["email"],"template":"alert"}',
    contract_checks: ["Returns delivery status", "Per-channel ack received"],
  },
  Analytics: {
    endpoints: ["POST /events", "GET /rollup", "POST /query"],
    sample_request: '{"event":"signup","props":{"plan":"pro"}}',
    contract_checks: ["Event accepted", "Aggregation correct"],
  },
  "AI/ML": {
    endpoints: ["POST /embed", "POST /search", "POST /upsert"],
    sample_request: '{"collection":"docs","query":"how do refunds work","top_k":5}',
    contract_checks: [
      "Embeddings returned (1536 dims)",
      "Top-k ranked by cosine similarity",
    ],
  },
  DevOps: {
    endpoints: ["POST /capture", "GET /issues", "POST /schedule"],
    sample_request: '{"message":"TypeError: cannot read x of undefined","severity":"error"}',
    contract_checks: ["Stack trace parsed", "Deduplicated against open issue"],
  },
  "UI Components": {
    endpoints: ["POST /submit", "GET /schema", "POST /track"],
    sample_request: '{"form_id":"contact_v2","values":{"name":"Ada"}}',
    contract_checks: ["Schema validation passed", "Event recorded"],
  },
  "Data Pipelines": {
    endpoints: ["POST /ingest", "POST /validate", "GET /report"],
    sample_request: "multipart: file=orders.csv, schema={...}",
    contract_checks: ["Schema validated", "Rejected rows surfaced in report"],
  },
};

const ENDPOINT_LATENCIES = [89, 145, 34, 178, 62, 211];

/** Build the recorded sandbox script for the /submit/[id]/status page. */
export function buildSandboxScript(record: SubmissionRecord): SandboxLine[] {
  const scenario =
    SANDBOX_SCENARIOS[record.category] ?? SANDBOX_SCENARIOS.Auth;
  const lines: SandboxLine[] = [];
  const totalEndpoints = scenario.endpoints.length;
  const passing = Math.min(
    record.metrics.endpoints_passing || totalEndpoints,
    totalEndpoints,
  );

  lines.push({
    text: `Starting container: hackmarket-sandbox-${record.slug}`,
    style: "neutral",
    delay: 0,
  });
  lines.push({
    text: "✓ Container started (memory: 512MB, cpu: 1.0)",
    style: "ok",
    delay: 1100,
  });
  lines.push({ text: "Installing dependencies...", style: "neutral", delay: 400 });
  lines.push({
    text: `✓ Installed ${record.metrics.deps_total} packages (${
      record.tech_stack[0] ?? record.language
    })`,
    style: "ok",
    delay: 1500,
  });
  lines.push({ text: "Detecting endpoints...", style: "neutral", delay: 500 });
  lines.push({
    text: `  Found: ${scenario.endpoints.join(", ")}`,
    style: "neutral",
    delay: 600,
  });

  scenario.endpoints.forEach((ep, i) => {
    const latency =
      ENDPOINT_LATENCIES[i % ENDPOINT_LATENCIES.length] +
      Math.round(Math.random() * 20 - 10);
    const ok = i < passing;
    lines.push({ text: `Testing ${ep}`, style: "neutral", delay: 600 });
    lines.push({
      text: `  Request: ${scenario.sample_request}`,
      style: "neutral",
      delay: 220,
    });
    lines.push({
      text: ok
        ? `  Response: 200 OK (${latency}ms)`
        : `  Response: 500 Internal Server Error (${latency}ms)`,
      style: ok ? "ok" : "err",
      delay: 320,
    });
    scenario.contract_checks.forEach((check) => {
      lines.push({
        text: ok ? `  ✓ ${check}` : `  ✗ ${check}`,
        style: ok ? "ok" : "err",
        delay: 200,
      });
    });
  });

  lines.push({ text: "Running security checks...", style: "neutral", delay: 700 });
  if (record.metrics.security.critical === 0) {
    lines.push({ text: "  ✓ No exposed secrets in env", style: "ok", delay: 350 });
  } else {
    lines.push({
      text: `  ✗ ${record.metrics.security.critical} critical secret leaks detected`,
      style: "err",
      delay: 350,
    });
  }
  if (record.metrics.security.medium > 0) {
    lines.push({
      text: `  ⚠ ${record.metrics.security.medium} medium-severity dep finding(s)`,
      style: "warn",
      delay: 300,
    });
  } else {
    lines.push({
      text: "  ✓ Dependencies have no critical CVEs",
      style: "ok",
      delay: 300,
    });
  }

  lines.push({
    text: "═══════════════════════════════════════════════════",
    style: "header",
    delay: 600,
  });
  lines.push({
    text: `CONFIDENCE SCORE: ${record.metrics.confidence}/100`,
    style:
      record.metrics.confidence >= 80
        ? "ok"
        : record.metrics.confidence >= 60
          ? "warn"
          : "err",
    delay: 400,
  });
  lines.push({
    text: `Endpoints tested: ${passing}/${totalEndpoints} passing`,
    style: passing === totalEndpoints ? "ok" : "warn",
    delay: 200,
  });
  lines.push({
    text: `Response times: p50 ${record.metrics.p50_response_ms}ms · p95 ${record.metrics.p95_response_ms}ms · p99 ${record.metrics.p99_response_ms}ms`,
    style: record.metrics.p95_response_ms < 250 ? "ok" : "warn",
    delay: 200,
  });
  lines.push({
    text: `I/O contract match: ${record.metrics.io_match_pct}%`,
    style: record.metrics.io_match_pct >= 90 ? "ok" : "warn",
    delay: 200,
  });
  lines.push({
    text: "═══════════════════════════════════════════════════",
    style: "header",
    delay: 200,
  });

  return lines;
}

/** Live testing script — used by the approver "monitor automated testing" view.
 *
 * Returns a richer set of stages (CI-pipeline style) with their per-step
 * timings. Total runtime ~18 seconds so a fresh testing submission becomes
 * review-ready within the demo window.
 */
export interface LiveTestStage {
  name: string;
  ms: number;
  lines: SandboxLine[];
}

export function buildLiveTestPlan(record: SubmissionRecord): LiveTestStage[] {
  const scenario =
    SANDBOX_SCENARIOS[record.category] ?? SANDBOX_SCENARIOS.Auth;
  const stack = record.tech_stack[0] ?? record.language;

  return [
    {
      name: "Cloning repository",
      ms: 1800,
      lines: [
        { text: `git clone --depth 1 ${record.github_url}`, style: "neutral", delay: 0 },
        { text: `Receiving objects: 100% (412/412), 86 KiB`, style: "neutral", delay: 700 },
        { text: `Resolving deltas: 100% (118/118)`, style: "neutral", delay: 400 },
        { text: `✓ Repository cloned`, style: "ok", delay: 320 },
      ],
    },
    {
      name: "Reading project structure",
      ms: 1400,
      lines: [
        { text: `Detected stack: ${stack}`, style: "neutral", delay: 0 },
        { text: `Found README.md, package manifest`, style: "neutral", delay: 350 },
        { text: `✓ Manifest parsed`, style: "ok", delay: 450 },
        { text: `✓ Entry point: ${record.tech_stack.includes("Python") ? "main.py" : "index.js"}`, style: "ok", delay: 400 },
      ],
    },
    {
      name: "Installing dependencies",
      ms: 2600,
      lines: [
        { text: `Installing... (${record.tech_stack.includes("Python") ? "pip" : "npm"})`, style: "neutral", delay: 0 },
        { text: `  added 24 packages`, style: "neutral", delay: 900 },
        { text: `  added 12 packages`, style: "neutral", delay: 700 },
        { text: `✓ All dependencies resolved`, style: "ok", delay: 600 },
      ],
    },
    {
      name: "Running test suite",
      ms: 3200,
      lines: [
        { text: `Discovering tests...`, style: "neutral", delay: 0 },
        { text: `  Found 14 test cases across 4 files`, style: "neutral", delay: 500 },
        { text: `  PASS  tests/unit/handler.spec`, style: "ok", delay: 650 },
        { text: `  PASS  tests/integration/api.spec`, style: "ok", delay: 700 },
        { text: `  PASS  tests/contract/io.spec`, style: "ok", delay: 580 },
        { text: `✓ 14/14 tests passed`, style: "ok", delay: 420 },
      ],
    },
    {
      name: "Checking endpoints",
      ms: 3400,
      lines: [
        { text: `Probing live endpoints...`, style: "neutral", delay: 0 },
        ...scenario.endpoints.flatMap((ep, i) => [
          { text: `  ${ep} ...`, style: "neutral" as const, delay: 600 + i * 250 },
          { text: `    ✓ 200 OK (${ENDPOINT_LATENCIES[i % ENDPOINT_LATENCIES.length]}ms)`, style: "ok" as const, delay: 220 },
        ]),
      ],
    },
    {
      name: "Measuring latency",
      ms: 2400,
      lines: [
        { text: `Running 100-request benchmark...`, style: "neutral", delay: 0 },
        { text: `  warming up...`, style: "neutral", delay: 600 },
        { text: `  p50: 78ms · p95: 142ms · p99: 198ms`, style: "ok", delay: 1100 },
        { text: `✓ Latency well within targets`, style: "ok", delay: 500 },
      ],
    },
    {
      name: "Security scan",
      ms: 2800,
      lines: [
        { text: `Auditing dependencies for CVEs...`, style: "neutral", delay: 0 },
        { text: `  ✓ No critical vulnerabilities`, style: "ok", delay: 900 },
        { text: `  ⚠ 1 medium-severity finding (transitive)`, style: "warn", delay: 700 },
        { text: `Scanning code for secrets...`, style: "neutral", delay: 600 },
        { text: `  ✓ No exposed credentials`, style: "ok", delay: 500 },
      ],
    },
    {
      name: "Computing confidence",
      ms: 1400,
      lines: [
        { text: `Weighing all signals...`, style: "neutral", delay: 0 },
        { text: `  endpoint coverage: weighted 0.30`, style: "neutral", delay: 350 },
        { text: `  I/O contract:      weighted 0.25`, style: "neutral", delay: 250 },
        { text: `  security + perf:   weighted 0.30`, style: "neutral", delay: 250 },
        { text: `  code quality:      weighted 0.15`, style: "neutral", delay: 250 },
      ],
    },
  ];
}

/** Total milliseconds for the live test plan. */
export function liveTestDurationMs(record: SubmissionRecord): number {
  return buildLiveTestPlan(record).reduce((sum, s) => sum + s.ms, 0);
}

// ─── Static "kc-style" SubmissionRecord generator for fresh submits ──────

export function newSubmissionFromAnalysis(args: {
  github_url: string;
  submitter_email: string;
  name: string;
  description: string;
  category: string;
  tech_stack: string[];
  inputs: string;
  outputs: string;
  pricing_model: "buy" | "royalty";
  price_cents: number;
}): SubmissionRecord {
  const id = newSubmissionId();
  const cleanName = sanitizeName(args.name) || "Untitled submission";
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return {
    id,
    name: cleanName,
    slug,
    github_url: args.github_url,
    submitter_email: args.submitter_email,
    language: args.tech_stack[0] ?? "Unknown",
    category: args.category,
    tech_stack: args.tech_stack,
    description: args.description,
    inputs: args.inputs,
    outputs: args.outputs,
    pricing_model: args.pricing_model,
    price_cents: args.price_cents,
    submitted_at: new Date().toISOString(),
    stage: "testing",
    testing_started_at: new Date().toISOString(),
    metrics: zeroMetrics(),
  };
}

export { nowPlus };
