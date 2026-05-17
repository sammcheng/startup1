"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildSandboxScript,
  getSubmission,
  type SandboxLine,
  type SubmissionRecord,
  type SubmissionStage,
} from "@/lib/submissions";

interface StageDef {
  id: SubmissionStage;
  label: string;
  blurb: string;
}

const STAGES: StageDef[] = [
  {
    id: "submitted",
    label: "Submitted",
    blurb: "Repo cloned, metadata extracted",
  },
  {
    id: "ai_testing",
    label: "AI Testing",
    blurb: "Sandbox runs your endpoints against the I/O contract",
  },
  {
    id: "manual_review",
    label: "Manual Review",
    blurb: "Assigned to a reviewer",
  },
  {
    id: "approved",
    label: "Approved",
    blurb: "Sign-off complete",
  },
  {
    id: "listed",
    label: "Listed",
    blurb: "Your tool is live on the marketplace",
  },
];

function stageIndex(stage: SubmissionStage): number {
  if (stage === "rejected") return STAGES.findIndex((s) => s.id === "manual_review");
  return STAGES.findIndex((s) => s.id === stage);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function scoreColor(n: number): string {
  if (n >= 80) return "#16a34a";
  if (n >= 60) return "#d97706";
  return "#dc2626";
}

export default function SubmissionStatusPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const found = getSubmission(id);
    setSubmission(found);
    setLoaded(true);
  }, [id]);

  if (!loaded) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          paddingTop: 120,
          paddingBottom: 80,
          color: "var(--muted)",
          textAlign: "center",
          fontFamily: "var(--font-mono)",
        }}
      >
        Loading submission…
      </main>
    );
  }

  if (!submission) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          paddingTop: 120,
          paddingBottom: 80,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 24px" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--muted)",
            }}
          >
            Submission not found
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              color: "var(--text)",
              marginTop: 12,
            }}
          >
            We can't find submission <code>{id}</code>.
          </h1>
          <p style={{ color: "var(--muted)", marginTop: 12 }}>
            It may have been pruned from local storage. Try one of the demo
            submissions below.
          </p>
          <div
            style={{
              marginTop: 24,
              display: "flex",
              justifyContent: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/submit/demo-1/status"
              style={demoChipStyle}
            >
              demo-1 (AuthForge)
            </Link>
            <Link
              href="/submit/demo-2/status"
              style={demoChipStyle}
            >
              demo-2 (DataPour)
            </Link>
            <Link
              href="/submit/demo-3/status"
              style={demoChipStyle}
            >
              demo-3 (QuickStats)
            </Link>
          </div>
          <p style={{ marginTop: 32 }}>
            <Link
              href="/submit"
              style={{ color: "var(--blue)", textDecoration: "none" }}
            >
              ← Submit another repo
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return <StatusView submission={submission} />;
}

const demoChipStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--card)",
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  color: "var(--text)",
  textDecoration: "none",
};

// ─── Status view ─────────────────────────────────────────────────────────

function StatusView({ submission }: { submission: SubmissionRecord }) {
  const activeIdx = stageIndex(submission.stage);
  const isRejected = submission.stage === "rejected";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        paddingTop: 92,
        paddingBottom: 80,
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "0 28px" }}>
        {/* Header */}
        <header style={{ marginBottom: 32 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--blue)",
            }}
          >
            Your submission
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 36,
              color: "var(--text)",
              margin: "12px 0 6px",
              letterSpacing: "-0.01em",
            }}
          >
            {submission.name}
          </h1>
          <div
            style={{
              fontSize: 13.5,
              color: "var(--muted)",
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <span>Submitted {timeAgo(submission.submitted_at)}</span>
            <span>·</span>
            <span>
              {submission.tech_stack.slice(0, 2).join(" + ") || submission.language}
            </span>
            <span>·</span>
            <a
              href={submission.github_url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--blue)", textDecoration: "none" }}
            >
              {submission.github_url.replace(/^https:\/\/github\.com\//, "")} ↗
            </a>
          </div>
        </header>

        {/* Vertical pipeline */}
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "28px 32px 32px",
            marginBottom: 28,
          }}
        >
          {STAGES.map((stage, i) => {
            const isComplete = !isRejected && i < activeIdx;
            const isCurrent = !isRejected && i === activeIdx;
            const isRejectedHere = isRejected && i === activeIdx;
            const isPending = !isComplete && !isCurrent && !isRejectedHere;
            const isLast = i === STAGES.length - 1;
            return (
              <StageRow
                key={stage.id}
                stage={stage}
                state={
                  isComplete
                    ? "complete"
                    : isCurrent
                      ? "current"
                      : isRejectedHere
                        ? "rejected"
                        : "pending"
                }
                isLast={isLast}
                submission={submission}
              />
            );
          })}
        </section>

        {/* Bottom row: confidence summary + next step CTAs */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
            gap: 18,
          }}
        >
          <ConfidenceCard submission={submission} />
          <NextStepsCard submission={submission} />
        </section>
      </div>
    </main>
  );
}

// ─── Stage row ───────────────────────────────────────────────────────────

type StageState = "complete" | "current" | "pending" | "rejected";

function StageRow({
  stage,
  state,
  isLast,
  submission,
}: {
  stage: StageDef;
  state: StageState;
  isLast: boolean;
  submission: SubmissionRecord;
}) {
  const dotColor =
    state === "complete"
      ? "#16a34a"
      : state === "current"
        ? "var(--blue)"
        : state === "rejected"
          ? "#dc2626"
          : "var(--border)";

  const dotInner =
    state === "complete"
      ? "✓"
      : state === "rejected"
        ? "✗"
        : state === "current"
          ? "•"
          : "";

  const lineColor =
    state === "complete" ? "#16a34a" : "var(--border)";

  return (
    <div style={{ display: "flex", gap: 18, position: "relative" }}>
      {/* Rail column */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 28,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background:
              state === "pending" ? "transparent" : dotColor,
            border: `2px solid ${dotColor}`,
            color: state === "pending" ? "transparent" : "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 700,
            animation:
              state === "current"
                ? "pulseStage 1.6s ease-in-out infinite"
                : undefined,
          }}
        >
          {dotInner}
        </div>
        {!isLast && (
          <div
            style={{
              flex: 1,
              width: 2,
              background:
                state === "complete"
                  ? lineColor
                  : `repeating-linear-gradient(to bottom, var(--border) 0 6px, transparent 6px 12px)`,
              minHeight: 60,
              marginTop: 4,
            }}
          />
        )}
      </div>

      {/* Content column */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 28 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 18,
              color:
                state === "pending" ? "var(--muted)" : "var(--text)",
              letterSpacing: "-0.005em",
            }}
          >
            {stage.label}
          </div>
          <StageStatusPill state={state} />
        </div>
        <div
          style={{
            color: "var(--muted)",
            fontSize: 13.5,
            marginTop: 4,
          }}
        >
          {stage.blurb}
        </div>

        {/* Stage-specific content */}
        {stage.id === "ai_testing" &&
          (state === "complete" || state === "current") && (
            <SandboxViewer submission={submission} live={state === "current"} />
          )}

        {stage.id === "manual_review" && state === "current" && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(37,99,235,0.08)",
              border: "1px solid rgba(37,99,235,0.18)",
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            Assigned to a reviewer · Estimated wait ~2 hours.{" "}
            <Link
              href={`/approver?focus=${submission.id}`}
              style={{ color: "var(--blue)" }}
            >
              View as approver →
            </Link>
          </div>
        )}

        {stage.id === "listed" && state === "complete" && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(22,163,74,0.08)",
              border: "1px solid rgba(22,163,74,0.18)",
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            🎉 Live on the marketplace.{" "}
            <Link
              href={`/tools/${submission.slug}`}
              style={{ color: "#16a34a", fontWeight: 600 }}
            >
              View listing →
            </Link>
          </div>
        )}

        {stage.id === "manual_review" && state === "rejected" && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(220,38,38,0.08)",
              border: "1px solid rgba(220,38,38,0.2)",
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            <div style={{ fontWeight: 600, color: "#dc2626" }}>
              Rejected
            </div>
            {submission.rejection_reason && (
              <div style={{ marginTop: 4 }}>{submission.rejection_reason}</div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulseStage {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.4);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(37, 99, 235, 0);
          }
        }
      `}</style>
    </div>
  );
}

function StageStatusPill({ state }: { state: StageState }) {
  const styles: Record<StageState, { bg: string; fg: string; label: string }> = {
    complete: { bg: "rgba(22,163,74,0.12)", fg: "#16a34a", label: "✓ Complete" },
    current: { bg: "rgba(37,99,235,0.12)", fg: "var(--blue)", label: "⏳ In progress" },
    pending: { bg: "rgba(107,104,96,0.12)", fg: "var(--muted)", label: "Pending" },
    rejected: { bg: "rgba(220,38,38,0.12)", fg: "#dc2626", label: "✗ Rejected" },
  };
  const s = styles[state];
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 999,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 500,
      }}
    >
      {s.label}
    </span>
  );
}

// ─── Sandbox terminal-style viewer ───────────────────────────────────────

function SandboxViewer({
  submission,
  live,
}: {
  submission: SubmissionRecord;
  live: boolean;
}) {
  const script: SandboxLine[] = useMemo(
    () => buildSandboxScript(submission),
    [submission],
  );

  const [shown, setShown] = useState<SandboxLine[]>(live ? [] : script);
  const [running, setRunning] = useState(live);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let cumulative = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    script.forEach((line, i) => {
      cumulative += line.delay ?? 220;
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setShown((prev) => [...prev, line]);
          if (i === script.length - 1) setRunning(false);
        }, cumulative),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [script, running]);

  const replay = () => {
    setShown([]);
    setRunning(true);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          background: "#0b0f17",
          borderRadius: 12,
          border: "1px solid #1f2937",
          overflow: "hidden",
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            background: "#0f172a",
            borderBottom: "1px solid #1f2937",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <span>SANDBOX: hackmarket-{submission.slug}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: running ? "#ef4444" : "#64748b",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: running ? "#ef4444" : "#64748b",
                animation: running ? "blink 1s ease-in-out infinite" : undefined,
              }}
            />
            {running ? "LIVE ● REC" : "RECORDED"}
          </span>
        </div>

        {/* Lines */}
        <div
          style={{
            padding: "18px 18px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.65,
            color: "#cbd5e1",
            minHeight: 240,
            maxHeight: 460,
            overflowY: "auto",
          }}
        >
          {shown.map((line, i) => (
            <SandboxLineView key={i} line={line} prefix={line.text.startsWith(" ") ? "" : "> "} />
          ))}
          {running && (
            <div style={{ marginTop: 6, color: "#64748b" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 14,
                  background: "#cbd5e1",
                  verticalAlign: "middle",
                  animation: "blink 1s ease-in-out infinite",
                }}
              />
            </div>
          )}
        </div>

        {!running && (
          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid #1f2937",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "#94a3b8",
            }}
          >
            <span>
              {script.length} lines · {Math.round(scriptDuration(script) / 1000)}s replay
            </span>
            <button
              onClick={replay}
              style={{
                background: "transparent",
                border: "1px solid #334155",
                color: "#cbd5e1",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "4px 12px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              ↻ Replay
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}

function scriptDuration(script: SandboxLine[]): number {
  return script.reduce((sum, l) => sum + (l.delay ?? 220), 0);
}

function SandboxLineView({ line, prefix }: { line: SandboxLine; prefix: string }) {
  const color =
    line.style === "ok"
      ? "#4ade80"
      : line.style === "warn"
        ? "#fbbf24"
        : line.style === "err"
          ? "#f87171"
          : line.style === "header"
            ? "#475569"
            : "#cbd5e1";
  const fadeIn: React.CSSProperties = {
    animation: "lineFadeIn 0.2s ease-out",
  };
  return (
    <div style={{ color, whiteSpace: "pre", ...fadeIn }}>
      {prefix}
      {line.text}
      <style jsx>{`
        @keyframes lineFadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Confidence summary + next steps ─────────────────────────────────────

function ConfidenceCard({ submission }: { submission: SubmissionRecord }) {
  const m = submission.metrics;
  const color = scoreColor(m.confidence);

  let verdict = "Passed AI review — forwarded to manual review.";
  if (m.confidence < 60) verdict = "Failed AI review — major issues need addressing.";
  else if (m.confidence < 80)
    verdict = "Passed with reservations — manual reviewer will assess.";

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "22px 26px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        AI Confidence Score
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginTop: 8 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 56,
            color,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {m.confidence}
        </div>
        <div
          style={{
            color: "var(--muted)",
            fontSize: 13,
            paddingBottom: 8,
          }}
        >
          / 100
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          height: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${m.confidence}%`,
            height: "100%",
            background: color,
            transition: "width 0.6s ease",
          }}
        />
      </div>

      <p style={{ color: "var(--text)", marginTop: 14, fontSize: 14 }}>{verdict}</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginTop: 16,
          fontSize: 13,
        }}
      >
        <Stat label="Endpoints" value={`${m.endpoints_passing}/${m.endpoints_total} passing`} />
        <Stat label="Avg response" value={`${m.avg_response_ms}ms`} />
        <Stat label="I/O match" value={`${m.io_match_pct}%`} />
        <Stat label="Security findings" value={`${m.security.critical}c · ${m.security.medium}m`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ color: "var(--text)", marginTop: 2, fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}

function NextStepsCard({ submission }: { submission: SubmissionRecord }) {
  const isRejected = submission.stage === "rejected";
  const isListed = submission.stage === "listed";

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "22px 26px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        What's next
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--text)",
          marginTop: 8,
          fontWeight: 600,
        }}
      >
        {isRejected
          ? "Address feedback and resubmit"
          : isListed
            ? "You're live!"
            : "Waiting on review"}
      </div>
      <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 13.5, lineHeight: 1.55 }}>
        {isRejected
          ? "Apply the changes called out by the reviewer above and submit again — your AI testing history will carry over."
          : isListed
            ? "Your tool is searchable now. Track usage and earnings from your dashboard."
            : "Reviewers typically respond within a few hours. We'll email you the moment a decision lands."}
      </p>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {isListed && (
          <Link
            href={`/tools/${submission.slug}`}
            style={primaryBtnStyle}
          >
            View your listing →
          </Link>
        )}
        {!isRejected && !isListed && (
          <Link
            href={`/approver?focus=${submission.id}`}
            style={primaryBtnStyle}
          >
            View as approver →
          </Link>
        )}
        <Link href="/dashboard" style={ghostBtnStyle}>
          Open dashboard
        </Link>
        <Link href="/submit" style={ghostBtnStyle}>
          Submit another build
        </Link>
      </div>
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 16px",
  borderRadius: 10,
  background: "var(--blue)",
  color: "#fff",
  fontSize: 13.5,
  fontWeight: 600,
  textDecoration: "none",
};

const ghostBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 16px",
  borderRadius: 10,
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  fontSize: 13.5,
  fontWeight: 500,
  textDecoration: "none",
};
