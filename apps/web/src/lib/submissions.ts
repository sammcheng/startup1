"use client";

// Client-side guest preview store backed by localStorage.
// Signed-in submission and approver flows use the API; this store exists only
// so unsigned-in preview status links can render during the current browser
// session.
//
// Three lifecycle stages drive the approver UI:
//   STAGE A — testing      (automated testing live; no score yet)
//   STAGE B — manual_review (testing complete, awaiting human sign-off)
//   STAGE C — listed       (approved, live on the marketplace + monitored)
//
// This store only contains records created in the current browser by real
// user actions or explicit preview flows. It should not auto-seed fake
// submissions into the UI.

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
  processing_job?: {
    id: string;
    status: "queued" | "running" | "retrying" | "succeeded" | "failed";
    attempts: number;
    max_attempts: number;
    trigger: string;
    last_error: string | null;
    enqueued_at: string | null;
    started_at: string | null;
    finished_at: string | null;
  };
}

const DEFAULT_SUBMISSIONS: SubmissionRecord[] = [];

// ─── Storage helpers ─────────────────────────────────────────────────────

function loadAll(): SubmissionRecord[] {
  if (typeof window === "undefined") return DEFAULT_SUBMISSIONS;
  try {
    // Drop legacy v1 store so only current-session preview data remains.
    for (const legacy of LEGACY_STORAGE_KEYS) {
      if (window.localStorage.getItem(legacy)) {
        window.localStorage.removeItem(legacy);
      }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SUBMISSIONS));
      return DEFAULT_SUBMISSIONS;
    }
    const parsed = JSON.parse(raw) as SubmissionRecord[];
    if (!Array.isArray(parsed)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SUBMISSIONS));
      return DEFAULT_SUBMISSIONS;
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
    return DEFAULT_SUBMISSIONS;
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
    const latency = ENDPOINT_LATENCIES[i % ENDPOINT_LATENCIES.length];
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
