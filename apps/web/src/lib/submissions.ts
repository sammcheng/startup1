"use client";

// Client-side submission store backed by localStorage.
// Both the creator-facing status tracker (/submit/[id]/status) and the
// approver dashboard (/approver) read from this store.
//
// For the hackathon demo we pre-seed 3 mock submissions with varied
// confidence scores so the approver dashboard is always populated.

const STORAGE_KEY = "hackmarket.submissions.v1";

export type SubmissionStage =
  | "submitted"
  | "ai_testing"
  | "manual_review"
  | "approved"
  | "listed"
  | "rejected";

export interface SubmissionMetrics {
  confidence: number; // 0-100
  endpoints_total: number;
  endpoints_passing: number;
  avg_response_ms: number;
  io_match_pct: number;
  security: {
    critical: number;
    medium: number;
    low: number;
  };
  // Code-quality block used by the PDF report
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
  reviewer_notes?: string;
  rejection_reason?: string;
}

// ─── Pre-seeded demo data ────────────────────────────────────────────────

function nowMinus(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const MOCK_SUBMISSIONS: SubmissionRecord[] = [
  {
    id: "demo-1",
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
  },
  {
    id: "demo-2",
    name: "DataPour",
    slug: "datapour",
    github_url: "https://github.com/hackmarket-demo/data-pipeline",
    submitter_email: "linus@torvalds.dev",
    language: "Python",
    category: "Data Pipelines",
    tech_stack: ["Python", "Pandas", "Pydantic"],
    description:
      "CSV / JSON / API data ingestion with schema validation. Rejects malformed rows and emits a structured validation report.",
    inputs: "Data source (file or API endpoint), target schema.",
    outputs: "Cleaned dataset, validation report, rejected rows.",
    pricing_model: "buy",
    price_cents: 650,
    submitted_at: nowMinus(72),
    stage: "manual_review",
    metrics: {
      confidence: 72,
      endpoints_total: 4,
      endpoints_passing: 3,
      avg_response_ms: 218,
      io_match_pct: 83,
      security: { critical: 0, medium: 3, low: 4 },
      docs_quality: "Fair",
      test_coverage_pct: 41,
      deps_total: 31,
      deps_outdated: 7,
      deps_vulnerable: 3,
      rate_limiting: false,
      consistent_errors: true,
      rest_conventions: false,
      loc: 3204,
      files: 41,
      license: "Apache-2.0",
      last_commit: nowMinus(60 * 24),
    },
  },
  {
    id: "demo-3",
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
  },
];

// ─── Storage helpers ─────────────────────────────────────────────────────

function loadAll(): SubmissionRecord[] {
  if (typeof window === "undefined") return MOCK_SUBMISSIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SUBMISSIONS));
      return MOCK_SUBMISSIONS;
    }
    const parsed = JSON.parse(raw) as SubmissionRecord[];
    if (!Array.isArray(parsed)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SUBMISSIONS));
      return MOCK_SUBMISSIONS;
    }
    return parsed;
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

// ─── Confidence score generator ──────────────────────────────────────────

export function newSubmissionId(): string {
  return `sub_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateMetricsForCategory(category: string): SubmissionMetrics {
  // Deterministic-ish baseline; we add a small randomness so demo runs differ.
  const r = (min: number, max: number) =>
    Math.round(min + Math.random() * (max - min));
  return {
    confidence: r(74, 92),
    endpoints_total: r(2, 5),
    endpoints_passing: 0, // set below
    avg_response_ms: r(60, 220),
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

// ─── Sandbox scenarios (animated terminal lines per category) ────────────

export interface SandboxLine {
  text: string;
  /** Optional indent — used by the renderer to nest under the previous step. */
  indent?: number;
  /** Style tag controls the line color. */
  style?: "neutral" | "ok" | "warn" | "err" | "header";
  /** Per-line delay before this line appears, in ms. */
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
    sample_request:
      '{"email":"test@example.com","password":"hunter2"}',
    contract_checks: ["Returns JWT token", "Response matches I/O contract"],
  },
  Payments: {
    endpoints: ["POST /subscribe", "POST /charge", "GET /invoices"],
    sample_request:
      '{"customer_id":"cus_8a2f","plan":"pro_monthly","metered":true}',
    contract_checks: ["Creates subscription", "Returns invoice URL"],
  },
  Notifications: {
    endpoints: ["POST /send", "GET /status/:id", "POST /templates"],
    sample_request:
      '{"recipient_id":"u_42","channels":["email"],"template":"alert"}',
    contract_checks: ["Returns delivery status", "Per-channel ack received"],
  },
  Analytics: {
    endpoints: ["POST /events", "GET /rollup", "POST /query"],
    sample_request:
      '{"event":"signup","props":{"plan":"pro"}}',
    contract_checks: ["Event accepted", "Aggregation correct"],
  },
  "AI/ML": {
    endpoints: ["POST /embed", "POST /search", "POST /upsert"],
    sample_request:
      '{"collection":"docs","query":"how do refunds work","top_k":5}',
    contract_checks: [
      "Embeddings returned (1536 dims)",
      "Top-k ranked by cosine similarity",
    ],
  },
  DevOps: {
    endpoints: ["POST /capture", "GET /issues", "POST /schedule"],
    sample_request:
      '{"message":"TypeError: cannot read x of undefined","severity":"error"}',
    contract_checks: ["Stack trace parsed", "Deduplicated against open issue"],
  },
  "UI Components": {
    endpoints: ["POST /submit", "GET /schema", "POST /track"],
    sample_request: '{"form_id":"contact_v2","values":{"name":"Ada"}}',
    contract_checks: ["Schema validation passed", "Event recorded"],
  },
  "Data Pipelines": {
    endpoints: ["POST /ingest", "POST /validate", "GET /report"],
    sample_request: 'multipart: file=orders.csv, schema={...}',
    contract_checks: [
      "Schema validated",
      "Rejected rows surfaced in report",
    ],
  },
};

const ENDPOINT_LATENCIES = [89, 145, 34, 178, 62, 211];

export function buildSandboxScript(
  record: SubmissionRecord,
): SandboxLine[] {
  const scenario =
    SANDBOX_SCENARIOS[record.category] ?? SANDBOX_SCENARIOS.Auth;
  const lines: SandboxLine[] = [];

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

  lines.push({
    text: "Installing dependencies...",
    style: "neutral",
    delay: 400,
  });
  lines.push({
    text: `✓ Installed ${record.metrics.deps_total} packages (${
      record.tech_stack[0] ?? record.language
    })`,
    style: "ok",
    delay: 1500,
  });

  lines.push({
    text: "Detecting endpoints...",
    style: "neutral",
    delay: 500,
  });
  lines.push({
    text: `  Found: ${scenario.endpoints.join(", ")}`,
    style: "neutral",
    delay: 600,
  });

  const passing = Math.min(
    record.metrics.endpoints_passing || scenario.endpoints.length,
    scenario.endpoints.length,
  );

  scenario.endpoints.forEach((ep, i) => {
    const latency =
      ENDPOINT_LATENCIES[i % ENDPOINT_LATENCIES.length] +
      Math.round(Math.random() * 20 - 10);
    const ok = i < passing;
    lines.push({
      text: `Testing ${ep}`,
      style: "neutral",
      delay: 600,
    });
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

  lines.push({
    text: "Running security checks...",
    style: "neutral",
    delay: 700,
  });
  if (record.metrics.security.critical === 0) {
    lines.push({
      text: "  ✓ No exposed secrets in env",
      style: "ok",
      delay: 350,
    });
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
    text: `Endpoints tested: ${passing}/${scenario.endpoints.length} passing`,
    style: passing === scenario.endpoints.length ? "ok" : "warn",
    delay: 200,
  });
  lines.push({
    text: `Security: ${record.metrics.security.critical} critical, ${record.metrics.security.medium} medium`,
    style: record.metrics.security.critical > 0 ? "err" : "neutral",
    delay: 200,
  });
  lines.push({
    text: `Response times: avg ${record.metrics.avg_response_ms}ms`,
    style: record.metrics.avg_response_ms < 200 ? "ok" : "warn",
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
  const slug = args.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const metrics = generateMetricsForCategory(args.category);
  metrics.endpoints_passing = metrics.endpoints_total;
  return {
    id,
    name: args.name,
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
    stage: "ai_testing",
    metrics,
  };
}
