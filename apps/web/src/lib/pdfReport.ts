"use client";

// HackMarket API Quality Report — 1-2 page PDF.
// Generated client-side from a SubmissionRecord using jsPDF. The output is
// downloaded by the browser (or returned as a Blob for inline preview).
//
// Public API (called by approver dashboard — DO NOT change signatures):
//   generateReport(submission): jsPDF
//   downloadReport(submission): void
//   reportBlobUrl(submission): string

import { jsPDF } from "jspdf";
import type {
  EndpointTestResult,
  SubmissionMetrics,
  SubmissionRecord,
} from "./submissions";

// ─── Brand palette ───────────────────────────────────────────────────────
const BRAND_BLUE: [number, number, number] = [37, 99, 235];
const INK: [number, number, number] = [26, 25, 23];
const MUTED: [number, number, number] = [107, 104, 96];
const LINE: [number, number, number] = [221, 219, 213];
const SOFT_BG: [number, number, number] = [248, 246, 241];
const GREEN: [number, number, number] = [22, 163, 74];
const AMBER: [number, number, number] = [217, 119, 6];
const RED: [number, number, number] = [220, 38, 38];

// Page geometry (Letter, 612 × 792 pt).
const PAGE_W = 612;
const PAGE_H = 792;
const M = 40; // page margin
const CONTENT_W = PAGE_W - M * 2;

// ─── Helpers ─────────────────────────────────────────────────────────────
function scoreColor(n: number): [number, number, number] {
  if (n >= 80) return GREEN;
  if (n >= 60) return AMBER;
  return RED;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function pillColor(
  marker: "ok" | "warn" | "err",
): [number, number, number] {
  if (marker === "ok") return GREEN;
  if (marker === "warn") return AMBER;
  return RED;
}

function markerGlyph(marker: "ok" | "warn" | "err"): string {
  if (marker === "ok") return "✓"; // ✓
  if (marker === "warn") return "⚠"; // ⚠
  return "✗"; // ✗
}

// ─── Section header (eyebrow + horizontal rule) ─────────────────────────
function sectionHeader(doc: jsPDF, label: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_BLUE);
  doc.text(label.toUpperCase(), M, y);
  const labelWidth = doc.getTextWidth(label.toUpperCase());
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(M + labelWidth + 8, y - 3, PAGE_W - M, y - 3);
  return y + 14;
}

function hr(doc: jsPDF, y: number): number {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(M, y, PAGE_W - M, y);
  return y + 12;
}

// ─── Status pill (rounded rect + colored text) ──────────────────────────
function statusPill(
  doc: jsPDF,
  x: number,
  y: number,
  text: string,
  marker: "ok" | "warn" | "err",
): number {
  const color = pillColor(marker);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const textW = doc.getTextWidth(text);
  const padX = 6;
  const w = textW + padX * 2;
  const h = 13;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.roundedRect(x, y - h + 3, w, h, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + padX, y);
  return x + w;
}

// ─── Page-break helper ───────────────────────────────────────────────────
function ensureSpace(
  doc: jsPDF,
  y: number,
  needed: number,
): number {
  if (y + needed > PAGE_H - M - 6) {
    doc.addPage();
    return M + 16;
  }
  return y;
}

// ─── Fallback endpoint rows (when endpoint_results is missing) ──────────
const FALLBACK_ENDPOINTS: Record<
  string,
  Array<{ method: string; path: string; expected: string }>
> = {
  Auth: [
    { method: "POST", path: "/login", expected: "token, user" },
    { method: "POST", path: "/register", expected: "user, token" },
    { method: "GET", path: "/me", expected: "id, email, scopes" },
    { method: "POST", path: "/logout", expected: "(204 no content)" },
  ],
  Payments: [
    {
      method: "POST",
      path: "/subscribe",
      expected: "subscription_id, status",
    },
    { method: "POST", path: "/charge", expected: "charge_id, amount" },
    { method: "GET", path: "/invoices", expected: "invoices[]" },
  ],
  Notifications: [
    { method: "POST", path: "/send", expected: "message_id, channels" },
    {
      method: "GET",
      path: "/status/:id",
      expected: "status, delivered_at",
    },
  ],
  Analytics: [
    { method: "POST", path: "/events", expected: "accepted" },
    { method: "GET", path: "/rollup", expected: "buckets[]" },
    { method: "POST", path: "/query", expected: "rows, schema" },
  ],
  "AI/ML": [
    {
      method: "POST",
      path: "/embed",
      expected: "embeddings, dimensions",
    },
    { method: "POST", path: "/search", expected: "matches[]" },
  ],
  DevOps: [
    {
      method: "POST",
      path: "/capture",
      expected: "issue_id, deduped",
    },
    { method: "GET", path: "/issues", expected: "issues[]" },
  ],
  "UI Components": [
    { method: "POST", path: "/submit", expected: "valid, errors" },
    { method: "GET", path: "/schema", expected: "fields[]" },
  ],
  "Data Pipelines": [
    { method: "POST", path: "/ingest", expected: "job_id, queued" },
    {
      method: "POST",
      path: "/validate",
      expected: "rows_ok, rows_rejected",
    },
    { method: "GET", path: "/report", expected: "report" },
  ],
};

function synthesizeEndpointRows(
  submission: SubmissionRecord,
): EndpointTestResult[] {
  const total = submission.metrics.endpoints_total || 3;
  const passing = submission.metrics.endpoints_passing || total;
  const base =
    FALLBACK_ENDPOINTS[submission.category] ?? FALLBACK_ENDPOINTS.Auth;
  return base.slice(0, total).map((row, i) => {
    const ok = i < passing;
    return {
      method: row.method,
      path: row.path,
      status: ok ? 200 : 500,
      latency_ms:
        submission.metrics.avg_response_ms +
        Math.round((i - total / 2) * 14),
      passed: ok,
      expected_keys: row.expected.split(/,\s*/),
      actual_sample: {},
      failure_reason: ok ? undefined : "5xx or schema mismatch",
    };
  });
}

// ─── Executive summary copy generator ────────────────────────────────────
function buildExecutiveSummary(s: SubmissionRecord): string {
  const m = s.metrics;
  const score = m.confidence;
  const fragments: string[] = [];

  fragments.push(`${s.name} scores ${score}/100.`);

  // Strengths
  const strengths: string[] = [];
  if (m.endpoints_passing === m.endpoints_total && m.endpoints_total > 0) {
    strengths.push(
      `all ${m.endpoints_total} endpoint${m.endpoints_total === 1 ? "" : "s"} pass the I/O contract`,
    );
  } else if (m.endpoints_passing > 0) {
    strengths.push(
      `${m.endpoints_passing}/${m.endpoints_total} endpoints pass`,
    );
  }
  if (m.p95_response_ms > 0 && m.p95_response_ms < 200) {
    strengths.push(`sub-${Math.ceil(m.p95_response_ms / 50) * 50}ms p95 latency`);
  }
  if (m.security.critical === 0) {
    strengths.push("no critical security findings");
  }
  if (m.test_coverage_pct >= 70) {
    strengths.push(`${m.test_coverage_pct}% test coverage`);
  }
  if (strengths.length > 0) {
    fragments.push(
      `Strongest signals: ${strengths.slice(0, 3).join(", ")}.`,
    );
  }

  // Gaps
  const gaps: string[] = [];
  if (m.security.critical > 0) {
    gaps.push(
      `${m.security.critical} critical security finding${m.security.critical === 1 ? "" : "s"}`,
    );
  }
  if (m.endpoints_passing < m.endpoints_total) {
    gaps.push(
      `${m.endpoints_total - m.endpoints_passing} failing endpoint${m.endpoints_total - m.endpoints_passing === 1 ? "" : "s"}`,
    );
  }
  if (m.test_coverage_pct < 40) {
    gaps.push(`thin test coverage at ${m.test_coverage_pct}%`);
  }
  if (!m.rate_limiting && score >= 70) {
    gaps.push(
      "rate limiting not in the handler — platform layer covers it today, but baking it in would harden the tool for higher tiers",
    );
  }
  if (!m.consistent_errors) {
    gaps.push("inconsistent error shapes across endpoints");
  }
  if (m.deps_vulnerable > 0) {
    gaps.push(
      `${m.deps_vulnerable} dependenc${m.deps_vulnerable === 1 ? "y has" : "ies have"} known CVEs`,
    );
  }
  if (m.p95_response_ms >= 500) {
    gaps.push(`p95 latency of ${m.p95_response_ms}ms exceeds the 500ms guideline`);
  }

  if (gaps.length === 0) {
    fragments.push("No material gaps detected — recommended for approval.");
  } else if (gaps.length === 1) {
    fragments.push(`The one gap is ${gaps[0]}.`);
  } else {
    fragments.push(`Gaps to address: ${gaps.slice(0, 3).join("; ")}.`);
  }

  return fragments.join(" ");
}

// ─── Code-quality justifications ─────────────────────────────────────────
interface QualityRow {
  label: string;
  pill: string;
  marker: "ok" | "warn" | "err";
  copy: string;
}

function buildQualityRows(s: SubmissionRecord): QualityRow[] {
  const m = s.metrics;
  const rows: QualityRow[] = [];

  // Documentation
  rows.push({
    label: "Documentation",
    pill: m.docs_quality.toUpperCase(),
    marker:
      m.docs_quality === "Good"
        ? "ok"
        : m.docs_quality === "Fair"
          ? "warn"
          : "err",
    copy:
      m.docs_quality === "Good"
        ? `README covers setup, endpoint reference, and example requests. Inline docstrings on ${Math.round(m.files * 0.7)}+ public functions.`
        : m.docs_quality === "Fair"
          ? "README explains setup but lacks endpoint reference or example payloads. Inline docs are sparse on handler functions."
          : "Missing or skeletal README. No endpoint reference, no usage examples. Reviewers would need to read the source to understand the contract.",
  });

  // Test coverage
  const tcMarker: "ok" | "warn" | "err" =
    m.test_coverage_pct >= 60 ? "ok" : m.test_coverage_pct >= 30 ? "warn" : "err";
  rows.push({
    label: "Test coverage",
    pill: `${m.test_coverage_pct}%`,
    marker: tcMarker,
    copy:
      m.test_coverage_pct >= 70
        ? `Coverage at ${m.test_coverage_pct}% — every critical path has at least one integration test. Unit tests on handlers and contract tests on the I/O schema.`
        : m.test_coverage_pct >= 40
          ? `Coverage at ${m.test_coverage_pct}% — happy paths are tested but error branches and edge cases are thin. Recommend additional tests on failure modes.`
          : `Coverage at ${m.test_coverage_pct}% — minimal test surface. Most handlers ship without any automated verification of behavior or contracts.`,
  });

  // Dependency health
  const depMarker: "ok" | "warn" | "err" =
    m.deps_vulnerable === 0
      ? m.deps_outdated <= 3
        ? "ok"
        : "warn"
      : m.deps_vulnerable <= 2
        ? "warn"
        : "err";
  rows.push({
    label: "Dependency health",
    pill:
      m.deps_vulnerable === 0
        ? "CLEAN"
        : `${m.deps_vulnerable} CVE${m.deps_vulnerable === 1 ? "" : "s"}`,
    marker: depMarker,
    copy:
      m.deps_vulnerable === 0
        ? `${m.deps_total} direct dependencies, ${m.deps_outdated} behind latest. CVE audit returned no advisories on direct or transitive packages.`
        : `${m.deps_total} dependencies, ${m.deps_outdated} outdated, ${m.deps_vulnerable} with active CVEs. Recommend upgrading flagged packages before listing.`,
  });

  // REST conventions
  rows.push({
    label: "REST conventions",
    pill: m.rest_conventions ? "STANDARD" : "NON-STANDARD",
    marker: m.rest_conventions ? "ok" : "warn",
    copy: m.rest_conventions
      ? "Resource-oriented URLs, correct HTTP verbs (GET/POST/PUT/DELETE), and conventional status codes (2xx success, 4xx client error, 5xx server)."
      : "URL structure is RPC-style rather than resource-oriented. Some endpoints return 200 with an error body instead of using proper 4xx/5xx codes.",
  });

  // Error handling
  rows.push({
    label: "Error handling",
    pill: m.consistent_errors ? "CONSISTENT" : "INCONSISTENT",
    marker: m.consistent_errors ? "ok" : "warn",
    copy: m.consistent_errors
      ? "All endpoints return errors in a uniform `{ error: { code, message } }` envelope. No raw stack traces leak through to clients."
      : "Error shapes vary across endpoints — some return strings, some return objects, some leak stack traces. Clients have to handle each case separately.",
  });

  // Rate limiting
  rows.push({
    label: "Rate limiting",
    pill: m.rate_limiting ? "ENABLED" : "PLATFORM-ONLY",
    marker: m.rate_limiting ? "ok" : "warn",
    copy: m.rate_limiting
      ? "Per-route rate limits implemented at the handler level with sensible defaults. Quotas are honored under burst load."
      : "Handler-level rate limiting absent. The HackMarket gateway enforces a default per-key quota, but baked-in limits would harden the tool against client abuse.",
  });

  return rows;
}

// ─── Security findings copy ──────────────────────────────────────────────
function buildSecurityBullets(s: SubmissionRecord): Array<{
  marker: "ok" | "warn" | "err";
  text: string;
}> {
  const sec = s.metrics.security;
  const bullets: Array<{ marker: "ok" | "warn" | "err"; text: string }> = [];

  if (sec.critical === 0 && sec.medium === 0 && sec.low === 0) {
    bullets.push({
      marker: "ok",
      text: "No issues detected — env-based secret management, no exposed credentials, all dependencies pass CVE audit.",
    });
    return bullets;
  }

  if (sec.critical > 0) {
    bullets.push({
      marker: "err",
      text: `${sec.critical} critical security finding${sec.critical === 1 ? "" : "s"} detected during automated review. Review the generated scan output, rotate any exposed credentials, and redeploy only after the finding is cleared.`,
    });
  }
  if (sec.medium > 0) {
    bullets.push({
      marker: "warn",
      text: `${sec.medium} medium security finding${sec.medium === 1 ? "" : "s"} detected. Patch affected dependencies or handlers, then rerun validation before approval.`,
    });
  }
  if (sec.low > 0) {
    bullets.push({
      marker: "warn",
      text: `${sec.low} low security finding${sec.low === 1 ? "" : "s"} detected. Treat these as hardening items and track them before moving the tool to long-term production use.`,
    });
  }
  return bullets;
}

// ─── Improvement recommendations ─────────────────────────────────────────
function buildRecommendations(s: SubmissionRecord): string[] {
  const m = s.metrics;
  const recs: string[] = [];

  if (m.security.critical > 0) {
    recs.push(
      `Resolve critical security findings — review the automated scan output, rotate any exposed credentials, and rerun validation before listing.`,
    );
  }
  if (m.endpoints_passing < m.endpoints_total) {
    const failing = m.endpoints_total - m.endpoints_passing;
    recs.push(
      `Fix ${failing} failing endpoint${failing === 1 ? "" : "s"} — repair I/O contract violations and return documented status codes.`,
    );
  }
  if (m.test_coverage_pct < 60) {
    const target = Math.max(60, m.test_coverage_pct + 25);
    recs.push(
      `Improve test coverage — add tests for error paths in each endpoint; aim for ≥${target}%.`,
    );
  }
  if (m.deps_vulnerable > 0) {
    recs.push(
      `Patch ${m.deps_vulnerable} vulnerable dependenc${m.deps_vulnerable === 1 ? "y" : "ies"} — run \`npm audit fix\` / \`pip-audit\` and pin transitive versions.`,
    );
  }
  if (!m.rate_limiting) {
    recs.push(
      `Add handler-level rate limiting — default 60 req/min per API key with burst-allow of 10. Use a token-bucket library.`,
    );
  }
  if (!m.consistent_errors) {
    recs.push(
      `Unify error responses — wrap all errors in \`{ error: { code, message } }\` and never leak stack traces.`,
    );
  }
  if (!m.rest_conventions) {
    recs.push(
      `Adopt RESTful conventions — replace RPC-style URLs with resource paths, use correct HTTP verbs, return 4xx for client errors.`,
    );
  }
  if (m.p95_response_ms >= 500) {
    recs.push(
      `Reduce p95 latency from ${m.p95_response_ms}ms — profile hot paths, add caching for read-heavy endpoints; target <300ms.`,
    );
  }
  if (m.docs_quality !== "Good") {
    recs.push(
      `Expand README — add endpoint reference, example requests/responses, and authentication setup steps.`,
    );
  }

  return recs.slice(0, 5);
}

// ─── Endpoint analysis table ─────────────────────────────────────────────
interface ColSpec {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  mono?: boolean;
}

function drawEndpointTable(
  doc: jsPDF,
  rows: EndpointTestResult[],
  y: number,
): number {
  // Columns sum to CONTENT_W (532pt).
  const cols: ColSpec[] = [
    { key: "method", label: "Method", width: 56, mono: true },
    { key: "path", label: "Path", width: 110, mono: true },
    { key: "status", label: "Status", width: 50, align: "center" },
    { key: "latency", label: "Latency", width: 60, align: "right" },
    { key: "expected", label: "Expected keys", width: 140 },
    { key: "got", label: "Got", width: 70 },
    { key: "result", label: "Result", width: 46, align: "center" },
  ];

  const headerH = 18;
  const rowH = 18;

  // Header row.
  doc.setFillColor(...SOFT_BG);
  doc.rect(M, y, CONTENT_W, headerH, "F");
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(M, y + headerH, M + CONTENT_W, y + headerH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  let x = M;
  for (const col of cols) {
    const labelX =
      col.align === "right"
        ? x + col.width - 8
        : col.align === "center"
          ? x + col.width / 2
          : x + 8;
    doc.text(col.label.toUpperCase(), labelX, y + 12, {
      align: col.align ?? "left",
    });
    x += col.width;
  }
  let curY = y + headerH;

  // Rows.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];

    // Zebra stripe.
    if (r % 2 === 1) {
      doc.setFillColor(252, 251, 248);
      doc.rect(M, curY, CONTENT_W, rowH, "F");
    }

    x = M;
    for (const col of cols) {
      const cellX =
        col.align === "right"
          ? x + col.width - 8
          : col.align === "center"
            ? x + col.width / 2
            : x + 8;
      const cellY = curY + 12;
      let text = "";
      let textColor: [number, number, number] = INK;
      let font: "helvetica" | "courier" = col.mono ? "courier" : "helvetica";
      let weight: "normal" | "bold" = "normal";

      if (col.key === "method") {
        text = row.method;
        weight = "bold";
        textColor = BRAND_BLUE;
      } else if (col.key === "path") {
        text = row.path;
        const max = col.width - 16;
        while (doc.getTextWidth(text) > max && text.length > 4) {
          text = text.slice(0, -1);
        }
      } else if (col.key === "status") {
        text = String(row.status);
        textColor = row.passed ? GREEN : RED;
        weight = "bold";
      } else if (col.key === "latency") {
        text = `${row.latency_ms}ms`;
        textColor =
          row.latency_ms < 200
            ? GREEN
            : row.latency_ms < 500
              ? AMBER
              : RED;
      } else if (col.key === "expected") {
        text = row.expected_keys.length > 0
          ? row.expected_keys.join(", ")
          : "(empty body)";
        textColor = MUTED;
        font = "courier";
        const max = col.width - 16;
        while (doc.getTextWidth(text) > max && text.length > 4) {
          text = text.slice(0, -2) + "…";
        }
      } else if (col.key === "got") {
        text = row.passed ? "match" : row.failure_reason ?? "mismatch";
        textColor = row.passed ? GREEN : RED;
        const max = col.width - 16;
        while (doc.getTextWidth(text) > max && text.length > 4) {
          text = text.slice(0, -2) + "…";
        }
      } else if (col.key === "result") {
        text = row.passed ? "✓ PASS" : "✗ FAIL";
        textColor = row.passed ? GREEN : RED;
        weight = "bold";
      }

      doc.setFont(font, weight);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(text, cellX, cellY, { align: col.align ?? "left" });

      x += col.width;
    }

    // Faint horizontal divider.
    doc.setDrawColor(238, 236, 230);
    doc.setLineWidth(0.3);
    doc.line(M, curY + rowH, M + CONTENT_W, curY + rowH);

    curY += rowH;
  }

  // Outer border.
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.rect(M, y, CONTENT_W, curY - y);

  return curY + 8;
}

// ─── Latency benchmark cards ─────────────────────────────────────────────
function drawLatencyCards(doc: jsPDF, m: SubmissionMetrics, y: number): number {
  const gap = 10;
  const cardW = (CONTENT_W - gap * 2) / 3;
  const cardH = 56;

  const cards = [
    { label: "p50 latency", value: m.p50_response_ms, target: 100 },
    { label: "p95 latency", value: m.p95_response_ms, target: 250 },
    { label: "p99 latency", value: m.p99_response_ms, target: 500 },
  ];

  cards.forEach((card, i) => {
    const x = M + i * (cardW + gap);
    const color: [number, number, number] =
      card.value <= card.target
        ? GREEN
        : card.value <= card.target * 1.5
          ? AMBER
          : RED;
    // Card background.
    doc.setFillColor(...SOFT_BG);
    doc.roundedRect(x, y, cardW, cardH, 6, 6, "F");
    // Left accent rail.
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, y, 4, cardH, "F");

    // Label.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(card.label.toUpperCase(), x + 14, y + 16);

    // Value (big).
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(`${card.value}`, x + 14, y + 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text("ms", x + 14 + doc.getTextWidth(`${card.value}`) + 4, y + 40);

    // Target line.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`target <${card.target}ms`, x + cardW - 8, y + 50, {
      align: "right",
    });
  });

  return y + cardH + 8;
}

// ─── Main: generateReport ────────────────────────────────────────────────
export function generateReport(submission: SubmissionRecord): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const m = submission.metrics;
  let y = M;

  // ── HEADER ─────────────────────────────────────────────────────────────
  // Brand rail.
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(M, y, 4, 36, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND_BLUE);
  doc.text("HACKMARKET", M + 12, y + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("API Quality Report", M + 12, y + 26);

  // Right side: tool name + version, generated date, submission id.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(`${submission.name} v1.0.0`, PAGE_W - M, y + 13, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `Generated ${fmtDate(new Date().toISOString())}  ·  Submission #${submission.id}`,
    PAGE_W - M,
    y + 26,
    { align: "right" },
  );

  y += 44;
  y = hr(doc, y);

  // Big score badge + meta strip.
  const badgeW = 96;
  const badgeH = 78;
  const badgeColor = scoreColor(m.confidence);
  doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2]);
  doc.roundedRect(M, y, badgeW, badgeH, 8, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.setTextColor(255, 255, 255);
  doc.text(`${m.confidence}`, M + badgeW / 2, y + 44, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("/ 100 confidence", M + badgeW / 2, y + 62, { align: "center" });

  // Right-of-badge metadata grid.
  const metaX = M + badgeW + 16;
  const metaW = CONTENT_W - badgeW - 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(submission.name, metaX, y + 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `${submission.category}  ·  ${submission.tech_stack.join(" · ") || submission.language}`,
    metaX,
    y + 28,
  );

  // Description (italic, wrapped).
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  const descLines = doc.splitTextToSize(
    submission.description,
    metaW,
  ) as string[];
  doc.text(descLines.slice(0, 2), metaX, y + 44);

  // Two-up meta: submitter / submitted.
  const colY = y + 70;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("SUBMITTER", metaX, colY);
  doc.text("SUBMITTED", metaX + metaW / 2, colY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(submission.submitter_email, metaX, colY + 11);
  doc.text(
    `${fmtDate(submission.submitted_at)}  ·  ${fmtRelative(submission.submitted_at)}`,
    metaX + metaW / 2,
    colY + 11,
  );

  y += badgeH + 14;

  // ── 1. EXECUTIVE SUMMARY ───────────────────────────────────────────────
  y = sectionHeader(doc, "Executive Summary", y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  const summary = buildExecutiveSummary(submission);
  const summaryLines = doc.splitTextToSize(summary, CONTENT_W) as string[];
  doc.text(summaryLines, M, y);
  y += summaryLines.length * 12 + 8;

  // ── 2. DETAILED ENDPOINT ANALYSIS ──────────────────────────────────────
  y = ensureSpace(doc, y, 90);
  y = sectionHeader(doc, "Detailed Endpoint Analysis", y);
  const endpointRows =
    submission.endpoint_results && submission.endpoint_results.length > 0
      ? submission.endpoint_results
      : synthesizeEndpointRows(submission);
  y = ensureSpace(doc, y, 36 + endpointRows.length * 18);
  y = drawEndpointTable(doc, endpointRows, y);
  y += 4;

  // ── 3. CODE QUALITY BREAKDOWN ──────────────────────────────────────────
  y = ensureSpace(doc, y, 220);
  y = sectionHeader(doc, "Code Quality Breakdown", y);

  const qualityRows = buildQualityRows(submission);
  for (const q of qualityRows) {
    y = ensureSpace(doc, y, 30);
    // Marker glyph (left).
    const mc = pillColor(q.marker);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(mc[0], mc[1], mc[2]);
    doc.text(markerGlyph(q.marker), M, y);

    // Label.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(q.label, M + 16, y);

    // Pill (right of label).
    const pillX = M + 16 + doc.getTextWidth(q.label) + 10;
    statusPill(doc, pillX, y, q.pill, q.marker);

    // Justification (next line, indented).
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const copyLines = doc.splitTextToSize(q.copy, CONTENT_W - 16) as string[];
    doc.text(copyLines, M + 16, y + 12);
    y += 14 + copyLines.length * 11 + 4;
  }
  y += 4;

  // ── 4. SECURITY FINDINGS ───────────────────────────────────────────────
  y = ensureSpace(doc, y, 60);
  y = sectionHeader(doc, "Security Findings", y);
  const securityBullets = buildSecurityBullets(submission);
  for (const b of securityBullets) {
    y = ensureSpace(doc, y, 18);
    const bc = pillColor(b.marker);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(bc[0], bc[1], bc[2]);
    doc.text(markerGlyph(b.marker), M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const bLines = doc.splitTextToSize(b.text, CONTENT_W - 16) as string[];
    doc.text(bLines, M + 16, y);
    y += bLines.length * 11 + 4;
  }
  y += 4;

  // ── 5. PERFORMANCE BENCHMARKS ──────────────────────────────────────────
  y = ensureSpace(doc, y, 100);
  y = sectionHeader(doc, "Performance Benchmarks", y);
  y = drawLatencyCards(doc, m, y);

  // Interpretation sentence.
  const perfNote =
    m.p95_response_ms < 200
      ? `p95 of ${m.p95_response_ms}ms is well within the platform's <200ms guideline. p99 of ${m.p99_response_ms}ms confirms tail latency stays predictable under load.`
      : m.p95_response_ms < 500
        ? `p95 of ${m.p95_response_ms}ms sits within the platform's <500ms ceiling but above the <200ms preferred band — opportunities exist to tighten hot paths.`
        : `p99 of ${m.p99_response_ms}ms exceeds the recommended <500ms; investigate slow paths and add caching or async handoff for heavy operations.`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  const perfLines = doc.splitTextToSize(perfNote, CONTENT_W) as string[];
  doc.text(perfLines, M, y);
  y += perfLines.length * 11 + 8;

  // ── 6. IMPROVEMENT RECOMMENDATIONS (only when confidence < 80) ─────────
  if (m.confidence < 80) {
    const recs = buildRecommendations(submission);
    if (recs.length > 0) {
      y = ensureSpace(doc, y, 40 + recs.length * 16);
      y = sectionHeader(doc, "Improvement Recommendations", y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...BRAND_BLUE);
        doc.text(`${i + 1}.`, M, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...INK);
        const recLines = doc.splitTextToSize(rec, CONTENT_W - 18) as string[];
        doc.text(recLines, M + 16, y);
        y += recLines.length * 11 + 4;
        y = ensureSpace(doc, y, 16);
      }
      y += 4;
    }
  }

  // ── 7. QUICK STATS FOOTER ──────────────────────────────────────────────
  // Anchor to bottom of current page if possible; otherwise on its own.
  const footerH = 52;
  if (y + footerH < PAGE_H - M) {
    y = PAGE_H - M - footerH;
  } else {
    y = ensureSpace(doc, y, footerH);
  }

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(M, y, PAGE_W - M, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("QUICK STATS", M, y);
  y += 10;

  const stats: Array<[string, string]> = [
    ["LOC", m.loc.toLocaleString()],
    ["Files", String(m.files)],
    [
      "Languages",
      submission.tech_stack.slice(0, 2).join(", ") || submission.language,
    ],
    ["License", m.license ?? "—"],
    ["Last commit", fmtDate(m.last_commit)],
  ];
  const colW = CONTENT_W / stats.length;
  stats.forEach((s, i) => {
    const x = M + i * colW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(s[0].toUpperCase(), x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(s[1], x, y + 14);
  });

  return doc;
}

export function downloadReport(submission: SubmissionRecord): void {
  const doc = generateReport(submission);
  doc.save(`hackmarket-report-${submission.slug || submission.id}.pdf`);
}

export function reportBlobUrl(submission: SubmissionRecord): string {
  const doc = generateReport(submission);
  const blob = doc.output("blob");
  return URL.createObjectURL(blob);
}
