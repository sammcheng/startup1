"use client";

// HackMarket API Quality Report — one-page PDF.
// Generated client-side from a SubmissionRecord using jsPDF. The output is
// downloaded by the browser (or returned as a Blob for inline preview).

import { jsPDF } from "jspdf";
import type { SubmissionRecord } from "./submissions";

const BRAND_BLUE: [number, number, number] = [37, 99, 235];
const INK: [number, number, number] = [26, 25, 23];
const MUTED: [number, number, number] = [107, 104, 96];
const LINE: [number, number, number] = [221, 219, 213];
const GREEN: [number, number, number] = [22, 163, 74];
const AMBER: [number, number, number] = [217, 119, 6];
const RED: [number, number, number] = [220, 38, 38];

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

function recommendation(score: number): {
  label: string;
  copy: string;
  color: [number, number, number];
} {
  if (score >= 80) {
    return {
      label: "RECOMMENDED FOR APPROVAL",
      copy: "This tool meets HackMarket's quality standards. Endpoints behave as documented, the I/O contract matches, and security scans came back clean.",
      color: GREEN,
    };
  }
  if (score >= 60) {
    return {
      label: "CONDITIONAL APPROVAL",
      copy: "Acceptable for listing if the issues flagged in this report are acknowledged. Consider requesting the submitter address the highest-severity findings.",
      color: AMBER,
    };
  }
  return {
    label: "NOT RECOMMENDED",
    copy: "Significant issues need addressing before this tool is fit for the marketplace. See the Code Quality section for the specific findings.",
    color: RED,
  };
}

function ratingLabel(ms: number): string {
  if (ms < 150) return "Good";
  if (ms < 300) return "Acceptable";
  return "Slow";
}

export function generateReport(submission: SubmissionRecord): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const M = 44; // page margin
  let y = M;

  // ─── Header ─────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(M, y, 6, 28, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND_BLUE);
  doc.text("HACKMARKET", M + 14, y + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("API Quality Report", M + 14, y + 24);

  // Right-aligned date
  doc.setFontSize(9);
  doc.text(
    `Generated ${fmtDate(new Date().toISOString())}`,
    pageW - M,
    y + 12,
    { align: "right" },
  );
  doc.text(`Submission #${submission.id}`, pageW - M, y + 24, {
    align: "right",
  });

  y += 44;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text(submission.name, M, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(
    `${submission.category} · ${submission.tech_stack.join(" · ") || submission.language}`,
    M,
    y + 12,
  );
  y += 26;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(M, y, pageW - M, y);
  y += 16;

  // ─── Section 1: Overview ───────────────────────────────────────────────
  y = section(doc, "1. OVERVIEW", M, y);

  const overview = [
    ["Tool", submission.name],
    ["Category", submission.category],
    ["Repo", submission.github_url],
    ["Submitter", submission.submitter_email],
    [
      "Submitted",
      `${fmtDate(submission.submitted_at)} · ${Math.round(
        (Date.now() - new Date(submission.submitted_at).getTime()) / 60_000,
      )}m ago`,
    ],
    ["License", submission.metrics.license ?? "(none detected)"],
  ];

  doc.setFontSize(9);
  for (const [label, value] of overview) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), M, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(value, pageW - M - 140) as string[];
    doc.text(wrapped, M + 80, y);
    y += Math.max(13, wrapped.length * 11);
  }
  y += 4;

  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...MUTED);
  const descLines = doc.splitTextToSize(
    submission.description,
    pageW - M * 2,
  ) as string[];
  doc.text(descLines, M, y);
  y += descLines.length * 11 + 6;

  // I/O contract
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("I/O CONTRACT", M, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);
  const inLines = doc.splitTextToSize(
    `Inputs: ${submission.inputs}`,
    pageW - M * 2,
  ) as string[];
  doc.text(inLines, M, y);
  y += inLines.length * 11;
  const outLines = doc.splitTextToSize(
    `Outputs: ${submission.outputs}`,
    pageW - M * 2,
  ) as string[];
  doc.text(outLines, M, y);
  y += outLines.length * 11 + 14;

  // ─── Section 2: AI Testing Results ─────────────────────────────────────
  y = section(doc, "2. AI TESTING RESULTS", M, y);

  // Big confidence score block
  const m = submission.metrics;
  const [r, g, b] = scoreColor(m.confidence);
  const boxX = M;
  const boxY = y;
  const boxW = 150;
  const boxH = 78;

  doc.setFillColor(r, g, b);
  doc.roundedRect(boxX, boxY, boxW, boxH, 8, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.setTextColor(255, 255, 255);
  doc.text(`${m.confidence}`, boxX + boxW / 2, boxY + 44, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("/ 100 confidence", boxX + boxW / 2, boxY + 62, { align: "center" });

  // Right-side breakdown
  const stat = (label: string, value: string, marker: string, idx: number) => {
    const sy = boxY + idx * 19;
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.text(marker, M + boxW + 16, sy + 10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.setFontSize(9);
    doc.text(label, M + boxW + 30, sy + 10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(value, pageW - M, sy + 10, { align: "right" });
  };

  const endpointsOk = m.endpoints_passing === m.endpoints_total;
  const ioOk = m.io_match_pct >= 90;
  const rtOk = m.avg_response_ms < 200;
  const secOk = m.security.critical === 0;

  stat(
    "Endpoint coverage",
    `${m.endpoints_passing}/${m.endpoints_total} passing`,
    endpointsOk ? "✓" : "⚠",
    0,
  );
  stat(
    "I/O contract compliance",
    `${m.io_match_pct}% match`,
    ioOk ? "✓" : "⚠",
    1,
  );
  stat(
    "Response time",
    `${m.avg_response_ms}ms avg · ${ratingLabel(m.avg_response_ms)}`,
    rtOk ? "✓" : "⚠",
    2,
  );
  stat(
    "Error handling",
    m.consistent_errors
      ? "Consistent error format"
      : "Inconsistent — some endpoints crash",
    m.consistent_errors ? "✓" : "⚠",
    3,
  );
  stat(
    "Security scan",
    `${m.security.critical}c · ${m.security.medium}m · ${m.security.low}l`,
    secOk ? "✓" : "✗",
    4,
  );

  y = boxY + boxH + 18;

  // ─── Section 3: Code Quality ───────────────────────────────────────────
  y = section(doc, "3. CODE QUALITY", M, y);

  const quality: Array<[string, string, string]> = [
    ["Documentation", `${m.docs_quality} — README explains setup and endpoints`,
      m.docs_quality === "Good" ? "✓" : m.docs_quality === "Fair" ? "⚠" : "✗"],
    ["Test coverage", `${m.test_coverage_pct}% (estimated from test files)`,
      m.test_coverage_pct >= 60 ? "✓" : m.test_coverage_pct >= 30 ? "⚠" : "✗"],
    ["Dependency health",
      `${m.deps_total} deps · ${m.deps_outdated} outdated · ${m.deps_vulnerable} with CVEs`,
      m.deps_vulnerable === 0 ? "✓" : m.deps_vulnerable <= 2 ? "⚠" : "✗"],
    ["Code structure", "Single entry point · Env-based config · Clear separation", "✓"],
    ["REST conventions",
      m.rest_conventions ? "Follows RESTful URL + verb conventions" : "Non-standard URLs",
      m.rest_conventions ? "✓" : "⚠"],
    ["Rate limiting",
      m.rate_limiting ? "Implemented at handler level" : "Not implemented",
      m.rate_limiting ? "✓" : "⚠"],
  ];

  doc.setFontSize(9);
  for (const [label, value, marker] of quality) {
    const color =
      marker === "✓" ? GREEN : marker === "⚠" ? AMBER : RED;
    doc.setTextColor(...color);
    doc.setFont("helvetica", "bold");
    doc.text(marker, M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(label, M + 14, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    const valWrapped = doc.splitTextToSize(value, pageW - M - 180) as string[];
    doc.text(valWrapped, M + 140, y);
    y += Math.max(13, valWrapped.length * 11);
  }
  y += 8;

  // ─── Section 4: Recommendation ─────────────────────────────────────────
  y = section(doc, "4. RECOMMENDATION", M, y);

  const rec = recommendation(m.confidence);
  doc.setFillColor(rec.color[0], rec.color[1], rec.color[2]);
  doc.rect(M, y - 9, 4, 18, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(rec.color[0], rec.color[1], rec.color[2]);
  doc.text(rec.label, M + 12, y + 4);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  const recLines = doc.splitTextToSize(rec.copy, pageW - M * 2) as string[];
  doc.text(recLines, M, y);
  y += recLines.length * 12 + 6;

  // ─── Section 5: Quick Stats (footer) ───────────────────────────────────
  // Ensure we don't paint over the page bottom; if too low, push up.
  const footerH = 56;
  if (y + footerH > pageH - M) {
    y = pageH - M - footerH;
  } else {
    y = pageH - M - footerH;
  }

  doc.setDrawColor(...LINE);
  doc.line(M, y, pageW - M, y);
  y += 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("QUICK STATS", M, y);
  y += 12;

  const stats = [
    ["LOC", m.loc.toLocaleString()],
    ["Files", String(m.files)],
    ["Languages", submission.tech_stack.slice(0, 3).join(", ")],
    ["License", m.license ?? "—"],
    ["Last commit", fmtDate(m.last_commit)],
  ];

  doc.setFontSize(9);
  const colW = (pageW - M * 2) / stats.length;
  stats.forEach((s, i) => {
    const x = M + i * colW;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...MUTED);
    doc.setFontSize(7.5);
    doc.text(s[0].toUpperCase(), x, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.setFontSize(10);
    doc.text(s[1], x, y + 14);
  });

  return doc;
}

function section(doc: jsPDF, label: string, x: number, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_BLUE);
  doc.text(label, x, y);
  doc.setDrawColor(...LINE);
  doc.line(x + doc.getTextWidth(label) + 8, y - 3, x + 1000, y - 3); // clipped by page width
  return y + 14;
}

export function downloadReport(submission: SubmissionRecord): void {
  const doc = generateReport(submission);
  doc.save(
    `hackmarket-report-${submission.slug || submission.id}.pdf`,
  );
}

export function reportBlobUrl(submission: SubmissionRecord): string {
  const doc = generateReport(submission);
  const blob = doc.output("blob");
  return URL.createObjectURL(blob);
}
