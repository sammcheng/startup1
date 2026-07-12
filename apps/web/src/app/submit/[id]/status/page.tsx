"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { toolToSubmissionRecord } from "@/lib/submission-adapter";
import {
  type SubmissionRecord,
  type SubmissionStage,
} from "@/lib/submissions";
import { safeGithubUrl } from "@/lib/safe-url";
import type { SellerSubmissionStatusResponse } from "@/types/seller";

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
    id: "testing",
    label: "Processing",
    blurb: "A durable worker prepares and validates your submission",
  },
  {
    id: "manual_review",
    label: "Manual Review",
    blurb: "Assigned to a reviewer",
  },
  {
    id: "listed",
    label: "Listed",
    blurb: "Your tool is live on the marketplace",
  },
];

function stageIndex(stage: SubmissionStage): number {
  if (stage === "rejected") {
    return STAGES.findIndex((s) => s.id === "manual_review");
  }
  if (stage === "revoked") return STAGES.findIndex((s) => s.id === "listed");
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
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const account = useCurrentAccount();
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSubmission() {
      if (!account.isLoaded) return;
      setLoadError(null);

      if (account.isSignedIn) {
        try {
          const token = await account.getToken();
          const status = await api.get<SellerSubmissionStatusResponse>(
            `/seller/submissions/${id}/status`,
            token ? { token } : undefined,
          );
          if (!active) return;
          setSubmission(toolToSubmissionRecord(status.tool, status.job));
          setLoaded(true);
          return;
        } catch (error) {
          if (!active) return;
          setSubmission(null);
          setLoadError(
            error instanceof ApiError
              ? error.message
              : "Could not load this owned submission from the API.",
          );
          setLoaded(true);
          return;
        }
      }

      if (!active) return;
      setSubmission(null);
      setLoadError("Sign in to view a submission owned by your account.");
      setLoaded(true);
    }

    void loadSubmission();
    const timer = account.isSignedIn
      ? setInterval(() => {
          void loadSubmission();
        }, 5000)
      : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [account, id]);

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
            {loadError ??
              (account.isSignedIn
                ? "We couldn't find a matching owned submission for this account."
                : "Sign in to view this submission.")}
          </p>
          <p style={{ marginTop: 32 }}>
            <Link
              href={account.isSignedIn ? "/submit" : "/sign-in"}
              style={{ color: "var(--blue)", textDecoration: "none" }}
            >
              {account.isSignedIn ? "← Submit another repo" : "Sign in →"}
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return <StatusView submission={submission} />;
}

// ─── Status view ─────────────────────────────────────────────────────────

function StatusView({ submission }: { submission: SubmissionRecord }) {
  const activeIdx = stageIndex(submission.stage);
  const isRejected = submission.stage === "rejected";
  const isRevoked = submission.stage === "revoked";
  const githubUrl = safeGithubUrl(submission.github_url);

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
            {githubUrl && (
              <>
                <span>·</span>
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--blue)", textDecoration: "none" }}
                >
                  {githubUrl.replace(/^https:\/\/github\.com\//, "")} ↗
                </a>
              </>
            )}
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
            const isComplete = i < activeIdx;
            const isCurrent = !isRejected && !isRevoked && i === activeIdx;
            const isRejectedHere = isRejected && i === activeIdx;
            const isRevokedHere = isRevoked && i === activeIdx;
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
                        : isRevokedHere
                          ? "revoked"
                        : "pending"
                }
                isLast={isLast}
                submission={submission}
              />
            );
          })}
        </section>

        {submission.processing_job && (
          <ProcessingJobCard submission={submission} />
        )}

        {/* Bottom row: confidence summary + next step CTAs */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
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

function ProcessingJobCard({ submission }: { submission: SubmissionRecord }) {
  const job = submission.processing_job;
  if (!job) return null;

  const labels = {
    queued: "Queued",
    running: "Running",
    retrying: "Retrying",
    succeeded: "Succeeded",
    failed: "Failed",
  };
  const colors = {
    queued: "var(--muted)",
    running: "var(--blue)",
    retrying: "#d97706",
    succeeded: "#16a34a",
    failed: "#dc2626",
  };
  const backgrounds = {
    queued: "rgba(107,104,96,0.12)",
    running: "rgba(37,99,235,0.12)",
    retrying: "rgba(217,119,6,0.12)",
    succeeded: "rgba(22,163,74,0.12)",
    failed: "rgba(220,38,38,0.12)",
  };
  const timestamp = job.started_at ?? job.enqueued_at ?? submission.submitted_at;

  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "18px 22px",
        marginBottom: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Worker job
        </div>
        <div style={{ color: "var(--text)", fontWeight: 600, marginTop: 6 }}>
          {labels[job.status]} · attempt {Math.max(job.attempts, job.status === "queued" ? 0 : 1)}
          /{job.max_attempts}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          Triggered by {job.trigger.replace(/_/g, " ")} · {timeAgo(timestamp)}
        </div>
        {job.last_error && (
          <div
            style={{
              marginTop: 10,
              color: "#dc2626",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {job.last_error}
          </div>
        )}
      </div>
      <span
        style={{
          background: backgrounds[job.status],
          color: colors[job.status],
          border: "1px solid var(--border)",
          borderRadius: 999,
          padding: "6px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {labels[job.status]}
      </span>
    </section>
  );
}

// ─── Stage row ───────────────────────────────────────────────────────────

type StageState = "complete" | "current" | "pending" | "rejected" | "revoked";

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
          : state === "revoked"
            ? "#d97706"
          : "var(--border)";

  const dotInner =
    state === "complete"
      ? "✓"
      : state === "rejected"
        ? "✗"
        : state === "revoked"
          ? "!"
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
            Your submission is waiting for an administrator to review it. This page updates when
            the decision is recorded.
          </div>
        )}

        {stage.id === "listed" && state === "current" && (
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
            Live on the marketplace.{" "}
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

        {stage.id === "listed" && state === "revoked" && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(217,119,6,0.08)",
              border: "1px solid rgba(217,119,6,0.2)",
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            <div style={{ fontWeight: 600, color: "#d97706" }}>Listing paused</div>
            {submission.rejection_reason && (
              <div style={{ marginTop: 4 }}>{submission.rejection_reason}</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function StageStatusPill({ state }: { state: StageState }) {
  const styles: Record<StageState, { bg: string; fg: string; label: string }> = {
    complete: { bg: "rgba(22,163,74,0.12)", fg: "#16a34a", label: "✓ Complete" },
    current: { bg: "rgba(37,99,235,0.12)", fg: "var(--blue)", label: "⏳ In progress" },
    pending: { bg: "rgba(107,104,96,0.12)", fg: "var(--muted)", label: "Pending" },
    rejected: { bg: "rgba(220,38,38,0.12)", fg: "#dc2626", label: "✗ Rejected" },
    revoked: { bg: "rgba(217,119,6,0.12)", fg: "#d97706", label: "Paused" },
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

// ─── Confidence summary + next steps ─────────────────────────────────────

function ConfidenceCard({ submission }: { submission: SubmissionRecord }) {
  const m = submission.metrics;
  const hasMetrics = submission.metrics_available === true;
  const color = hasMetrics ? scoreColor(m.confidence) : "var(--muted)";

  let verdict: string;
  if (!hasMetrics) {
    verdict = "No measured quality report is stored for this submission yet.";
  } else if (m.confidence < 60) {
    verdict = "The measured report found major issues that need attention.";
  } else if (m.confidence < 80) {
    verdict = "The measured report passed with items for manual review.";
  } else {
    verdict = "The measured report passed and is ready for manual review.";
  }

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
        Quality score
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
          {hasMetrics ? m.confidence : "—"}
        </div>
        <div
          style={{
            color: "var(--muted)",
            fontSize: 13,
            paddingBottom: 8,
          }}
        >
          {hasMetrics ? "/ 100" : "not available"}
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
            width: `${hasMetrics ? m.confidence : 0}%`,
            height: "100%",
            background: color,
            transition: "width 0.6s ease",
          }}
        />
      </div>

      <p style={{ color: "var(--text)", marginTop: 14, fontSize: 14 }}>{verdict}</p>

      {hasMetrics && (
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
      )}
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
  const isRevoked = submission.stage === "revoked";
  const isProcessing = submission.stage === "testing";

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
          : isRevoked
            ? "Your listing is paused"
          : isListed
            ? "You're live!"
            : isProcessing
              ? "Processing is underway"
              : "Waiting on review"}
      </div>
      <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 13.5, lineHeight: 1.55 }}>
        {isRejected
          ? "Review the recorded reason above, apply the needed changes, and submit the updated repository again."
          : isRevoked
            ? "Review the recorded reason above before asking an administrator to restore the listing."
          : isListed
            ? "Your tool is searchable now. Open your dashboard to see activity recorded for your account."
            : isProcessing
              ? "The durable worker status above updates automatically while your submission is processed."
              : "An administrator has not recorded a decision yet. This page updates automatically."}
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
