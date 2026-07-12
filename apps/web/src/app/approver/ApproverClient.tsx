"use client";

// Approver Dashboard — dense, viewport-fitting layout with three stages:
//
//   STAGE A — durable processing job status
//   STAGE B — review ready (scorecard + approve/reject + PDF report)
//   STAGE C — listed & live (verified usage + revoke)
//
// Layout: two-column on ≥1280px (queue 360px · detail flex), single column
// stacking on narrow viewports. Both panels are bounded to viewport height
// so the action buttons stay visible without scrolling.

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  sanitizeName,
  type SandboxLine,
  type SubmissionRecord,
} from "@/lib/submissions";
import { api, ApiError } from "@/lib/api";
import { syncCurrentUser } from "@/lib/auth-sync";
import { useCurrentAccount } from "@/hooks/useAuth";
import { toolToSubmissionRecord } from "@/lib/submission-adapter";
import { safeGithubUrl } from "@/lib/safe-url";
import type { Tool, ToolListResponse, ToolStatus } from "@/types/tool";
import type { ToolProcessingJob } from "@/types/seller";

type AdminReviewStatus = Extract<ToolStatus, "draft" | "processing" | "live" | "paused" | "rejected">;

interface AdminProcessingJobListResponse {
  items: ToolProcessingJob[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ─── Auth wrapper ─────────────────────────────────────────────────────────

export default function ApproverClient() {
  const account = useCurrentAccount();
  const [access, setAccess] = useState<
    "checking" | "ready" | "signed_out" | "forbidden" | "not_configured" | "error"
  >("checking");
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    if (!account.isLoaded) {
      setAccess("checking");
      return;
    }

    if (!account.isAuthConfigured) {
      setAdminToken(null);
      setAccess("not_configured");
      return;
    }

    if (!account.isSignedIn || !account.user) {
      setAdminToken(null);
      setAccess("signed_out");
      return;
    }

    let active = true;
    async function verifyAdmin() {
      setAccess("checking");
      setAccessError(null);
      try {
        const token = await account.getToken();
        if (!token) {
          throw new Error("Your session token is missing. Sign in again and retry.");
        }
        const synced = await syncCurrentUser(account.user!, token);
        if (synced?.role !== "admin") {
          if (!active) return;
          setAdminToken(null);
          setAccess("forbidden");
          return;
        }
        if (!active) return;
        setAdminToken(token);
        setAccess("ready");
      } catch (error) {
        if (!active) return;
        setAdminToken(null);
        setAccessError(error instanceof Error ? error.message : "Could not verify admin access.");
        setAccess("error");
      }
    }

    void verifyAdmin();
    return () => {
      active = false;
    };
  }, [account]);

  if (access === "checking") {
    return (
      <PageShell>
        <Centered text="Checking access…" />
      </PageShell>
    );
  }

  if (access === "not_configured") {
    return (
      <AccessGate
        title="Admin auth is not configured"
        body="Clerk keys are required before the approver queue can run. Production builds now fail without those keys, so this page cannot fall back to a local admin token."
      />
    );
  }

  if (access === "signed_out") {
    return (
      <AccessGate
        title="Sign in as an admin"
        body="The approver queue is only available to signed-in accounts with the admin role."
        action={<Link href="/sign-in" style={primaryBtnStyle as React.CSSProperties}>Sign in</Link>}
      />
    );
  }

  if (access === "forbidden") {
    return (
      <AccessGate
        title="Admin role required"
        body="Your account is signed in, but it is not marked as an admin in Hackmarket. Ask an existing admin to update your account role before reviewing tools."
      />
    );
  }

  if (access === "error" || !adminToken) {
    return (
      <AccessGate
        title="Could not verify admin access"
        body={accessError ?? "The API could not confirm your account role. Try signing in again."}
      />
    );
  }

  return <Dashboard token={adminToken} />;
}

// ─── Dashboard ────────────────────────────────────────────────────────────

function Dashboard({ token }: { token: string }) {
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [queueStatus, setQueueStatus] = useState<"loading" | "ready" | "error">("loading");
  const [queueError, setQueueError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const loadQueue = useCallback(async (silent = false) => {
    if (!silent) {
      setQueueStatus("loading");
      setQueueError(null);
    }
    try {
      const [response, jobsResponse] = await Promise.all([
        api.get<ToolListResponse>("/admin/tools?limit=100", { token }),
        api.get<AdminProcessingJobListResponse>("/admin/processing-jobs?limit=100", { token }),
      ]);
      const latestJobByTool = new Map<string, ToolProcessingJob>();
      for (const job of jobsResponse.items) {
        if (!latestJobByTool.has(job.tool_id)) latestJobByTool.set(job.tool_id, job);
      }
      setSubmissions(
        response.items.map((tool) => toolToSubmissionRecord(tool, latestJobByTool.get(tool.id))),
      );
      setQueueStatus("ready");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load the live approver queue.";
      setQueueError(message);
      if (!silent) setQueueStatus("error");
    }
  }, [token]);

  useEffect(() => {
    void loadQueue();
    const interval = window.setInterval(() => void loadQueue(true), 10_000);
    return () => window.clearInterval(interval);
  }, [loadQueue]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedFocus = url.searchParams.get("focus");
    if (requestedFocus) setFocusId(requestedFocus);
  }, []);

  const testing = submissions.filter((s) => s.stage === "testing");
  const reviewQueue = submissions.filter((s) => s.stage === "manual_review");
  const live = submissions.filter((s) => s.stage === "listed");

  // Default focus: first review-ready, then testing, then live.
  const defaultFocusId =
    reviewQueue[0]?.id ?? testing[0]?.id ?? live[0]?.id ?? null;

  useEffect(() => {
    if (!defaultFocusId) return;
    if (!focusId || !submissions.some((submission) => submission.id === focusId)) {
      setFocusId(defaultFocusId);
    }
  }, [defaultFocusId, focusId, submissions]);

  const focused = focusId
    ? submissions.find((submission) => submission.id === focusId) ?? null
    : null;

  const [toast, setToast] = useState<string | null>(null);
  function flash(msg: string) {
    setToast(msg);
  }

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function updateToolReviewStatus(
    submission: SubmissionRecord,
    status: AdminReviewStatus,
    options: { processingError?: string | null; successMessage: string },
  ) {
    try {
      const body: {
        status: AdminReviewStatus;
        processing_error?: string | null;
      } = { status };
      if ("processingError" in options) {
        body.processing_error = options.processingError ?? null;
      }
      await api.patch<Tool>(`/admin/tools/${submission.id}/review`, body, { token });
      flash(options.successMessage);
      await loadQueue();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not update this tool. Try again.";
      flash(message);
    }
  }

  return (
    <PageShell>
      <Header counts={{ testing: testing.length, review: reviewQueue.length, live: live.length }} />

      <div className="appr-grid">
        {/* Left column — queue */}
        <aside className="appr-queue">
          <QueueGroup
            title="Testing in progress"
            count={testing.length}
            badgeColor="#6366f1"
            empty="No tools running automated tests."
          >
            {testing.map((s) => (
              <TestingCard
                key={s.id}
                submission={s}
                focused={focused?.id === s.id}
                onClick={() => setFocusId(s.id)}
              />
            ))}
          </QueueGroup>

          <QueueGroup
            title="Review ready"
            count={reviewQueue.length}
            badgeColor="var(--blue)"
            empty="Inbox zero."
          >
            {reviewQueue.map((s) => (
              <ReviewCard
                key={s.id}
                submission={s}
                focused={focused?.id === s.id}
                onClick={() => setFocusId(s.id)}
              />
            ))}
          </QueueGroup>

          <QueueGroup
            title="Live tools"
            count={live.length}
            badgeColor="#16a34a"
            empty="No tools have been listed yet."
          >
            {live.map((s) => (
              <LiveCard
                key={s.id}
                submission={s}
                focused={focused?.id === s.id}
                onClick={() => setFocusId(s.id)}
              />
            ))}
          </QueueGroup>
        </aside>

        {/* Right column — detail */}
        <section className="appr-detail">
          {focused ? (
            focused.stage === "testing" ? (
              <TestingPanel submission={focused} />
            ) : focused.stage === "manual_review" ? (
              <ReviewPanel
                submission={focused}
                onApprove={(submission) =>
                  updateToolReviewStatus(submission, "live", {
                    processingError: null,
                    successMessage: `Approved ${submission.name} — now live on the marketplace.`,
                  })
                }
                onReject={(submission, reason) =>
                  updateToolReviewStatus(submission, "rejected", {
                    processingError: reason,
                    successMessage: `Rejected ${submission.name}.`,
                  })
                }
              />
            ) : focused.stage === "listed" ? (
              <LivePanel
                submission={focused}
                onRevoke={(submission, reason) =>
                  updateToolReviewStatus(submission, "paused", {
                    processingError: reason,
                    successMessage: `Revoked ${submission.name}.`,
                  })
                }
              />
            ) : (
              <ArchivedPanel submission={focused} />
            )
          ) : queueStatus === "loading" ? (
            <Centered text="Loading live review queue…" />
          ) : queueStatus === "error" ? (
            <QueueError message={queueError ?? "Could not load the approver queue."} onRetry={loadQueue} />
          ) : (
            <Centered text="Select a submission from the queue." />
          )}
        </section>
      </div>

      {toast && <Toast>{toast}</Toast>}
    </PageShell>
  );
}

// ─── PageShell + Header ────────────────────────────────────────────────────

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        paddingTop: 68,
        paddingBottom: 24,
      }}
    >
      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "0 24px" }}>
        {children}
      </div>
    </main>
  );
}

function Header({
  counts,
}: {
  counts: { testing: number; review: number; live: number };
}) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <div>
        <Eyebrow>Approver dashboard</Eyebrow>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 22,
            color: "var(--text)",
            margin: "4px 0 2px",
            letterSpacing: "-0.01em",
          }}
        >
          {counts.review} pending review
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
          {counts.testing} testing · {counts.review} ready · {counts.live} live
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Pill bg="rgba(99,102,241,0.12)" fg="#6366f1">
          {counts.testing} testing
        </Pill>
        <Pill bg="rgba(37,99,235,0.12)" fg="var(--blue)">
          {counts.review} ready
        </Pill>
        <Pill bg="rgba(22,163,74,0.12)" fg="#16a34a">
          {counts.live} live
        </Pill>
      </div>
    </header>
  );
}

// ─── Queue groups + cards ─────────────────────────────────────────────────

function QueueGroup({
  title,
  count,
  badgeColor,
  empty,
  children,
}: {
  title: string;
  count: number;
  badgeColor: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Eyebrow>{title}</Eyebrow>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 999,
            background: `${badgeColor}1F`,
            color: badgeColor,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 600,
          }}
        >
          {count}
        </span>
      </div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {count === 0 ? (
          <div
            style={{
              padding: "14px 10px",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 12.5,
            }}
          >
            {empty}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

interface CardProps {
  submission: SubmissionRecord;
  focused: boolean;
  onClick: () => void;
}

function TestingCard({ submission, focused, onClick }: CardProps) {
  const job = submission.processing_job;
  const status = job?.status ?? "running";
  const statusLabel = status === "retrying" ? "Retrying" : status === "queued" ? "Queued" : "Running";
  const statusColor = status === "retrying" ? "#d97706" : "#6366f1";
  const statusBackground = status === "retrying" ? "rgba(217,119,6,0.14)" : "rgba(99,102,241,0.14)";
  const statusTime = job?.started_at ?? job?.enqueued_at ?? submission.testing_started_at;

  return (
    <CardShell focused={focused} onClick={onClick}>
      <CardLine
        name={submission.name}
        right={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 8px",
              borderRadius: 999,
              background: statusBackground,
              color: statusColor,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            <span className="appr-pulse" />
            {statusLabel}
          </span>
        }
      />
      <CardSub>
        {submission.tech_stack.slice(0, 2).join(" + ") || submission.language}
        {statusTime ? ` · ${timeAgo(statusTime)}` : ""}
      </CardSub>
      <div
        style={{
          marginTop: 6,
          height: 4,
          background: "var(--bg)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            background: statusColor,
            width: "100%",
            opacity: 0.38,
          }}
        />
      </div>
    </CardShell>
  );
}

function ReviewCard({ submission, focused, onClick }: CardProps) {
  const m = submission.metrics;
  const hasMetrics = submission.metrics_available === true;
  return (
    <CardShell focused={focused} onClick={onClick}>
      <CardLine
        name={submission.name}
        right={
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 700,
              color: hasMetrics ? scoreColor(m.confidence) : "var(--muted)",
            }}
          >
            {hasMetrics ? `${m.confidence}/100` : "UNMEASURED"}
          </span>
        }
      />
      <CardSub>
        <span>{submission.tech_stack.slice(0, 2).join(" + ") || submission.language}</span>
        <span style={{ marginLeft: "auto" }}>{timeAgo(submission.submitted_at)}</span>
      </CardSub>
      <CardSub style={{ fontSize: 11 }}>
        {hasMetrics
          ? `${m.endpoints_passing}/${m.endpoints_total} pass · p95 ${m.p95_response_ms}ms`
          : "No automated quality report is stored for this tool."}
      </CardSub>
    </CardShell>
  );
}

function LiveCard({ submission, focused, onClick }: CardProps) {
  const live = submission.live;
  return (
    <CardShell focused={focused} onClick={onClick}>
      <CardLine
        name={submission.name}
        right={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 999,
              background: "rgba(22,163,74,0.12)",
              color: "#16a34a",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            ● LIVE
          </span>
        }
      />
      <CardSub>
        <span>{(live?.api_calls_total ?? 0).toLocaleString()} total calls</span>
        <span style={{ marginLeft: "auto" }}>
          {live ? `updated ${timeAgo(live.last_updated_at)}` : ""}
        </span>
      </CardSub>
      <CardSub style={{ fontSize: 11 }}>
        Live monitoring details appear only after measured telemetry is available.
      </CardSub>
    </CardShell>
  );
}

function CardShell({
  focused,
  onClick,
  children,
}: {
  focused: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "9px 12px",
        background: focused ? "rgba(37,99,235,0.06)" : "transparent",
        border: `1px solid ${focused ? "var(--blue)" : "var(--border)"}`,
        borderRadius: 10,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        transition: "all 0.12s",
      }}
    >
      {children}
    </button>
  );
}

function CardLine({ name, right }: { name: string; right: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {sanitizeName(name) || "Untitled"}
      </span>
      {right}
    </div>
  );
}

function CardSub({
  children,
  style,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11.5,
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Detail panels ────────────────────────────────────────────────────────

function DetailFrame({
  header,
  body,
  actions,
}: {
  header: ReactNode;
  body: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "18px 26px 14px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {header}
      </div>
      <div className="appr-detail-body">{body}</div>
      {actions && <div className="appr-detail-actions">{actions}</div>}
    </div>
  );
}

function DetailHeader({ submission }: { submission: SubmissionRecord }) {
  const githubUrl = safeGithubUrl(submission.github_url);

  return (
    <>
      <Eyebrow>Submission · {submission.id}</Eyebrow>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          color: "var(--text)",
          margin: "4px 0 4px",
          letterSpacing: "-0.01em",
        }}
      >
        {sanitizeName(submission.name) || "Untitled"}
      </h2>
      <div
        style={{
          color: "var(--muted)",
          fontSize: 12.5,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <span>{submission.category}</span>
        <Sep />
        <span>{submission.tech_stack.join(" · ") || submission.language}</span>
        <Sep />
        {githubUrl && (
          <>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--blue)", textDecoration: "none" }}
            >
              repo ↗
            </a>
            <Sep />
          </>
        )}
        <span style={{ fontFamily: "var(--font-mono)" }}>{submission.submitter_email}</span>
      </div>
    </>
  );
}

// ─── Stage A: Testing Panel (live CI-pipeline-style monitor) ─────────────

function TestingPanel({ submission }: { submission: SubmissionRecord }) {
  const job = submission.processing_job;
  const statusLabel = job?.status === "retrying"
    ? "Retrying"
    : job?.status === "queued"
      ? "Queued"
      : "Running";
  const statusColor = job?.status === "retrying" ? "#d97706" : "#6366f1";
  const eventLines: SandboxLine[] = job
    ? [
      { text: `Job ${job.id}`, style: "header" },
      { text: `Status: ${job.status}`, style: "neutral" },
      { text: `Attempt ${job.attempts} of ${job.max_attempts}`, style: "neutral" },
      { text: `Trigger: ${job.trigger}`, style: "neutral" },
      ...(job.enqueued_at
        ? [{ text: `Queued: ${new Date(job.enqueued_at).toLocaleString()}` }]
        : []),
      ...(job.started_at
        ? [{ text: `Started: ${new Date(job.started_at).toLocaleString()}` }]
        : []),
      ...(job.last_error
        ? [{ text: `Last error: ${job.last_error}`, style: "warn" as const }]
        : []),
    ]
    : [
      {
        text: "Tool is processing; durable job details are not available.",
        style: "warn",
      },
    ];
  const startedAtValue = job?.started_at ?? job?.enqueued_at ?? submission.testing_started_at;

  return (
    <DetailFrame
      header={
        <>
          <DetailHeader submission={submission} />
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--muted)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 999,
                background: job?.status === "retrying" ? "rgba(217,119,6,0.14)" : "rgba(99,102,241,0.14)",
                color: statusColor,
                fontWeight: 600,
              }}
            >
              <span className="appr-pulse-large" /> {statusLabel.toUpperCase()}
            </span>
            <span>
              Durable worker job{job ? ` · attempt ${job.attempts}/${job.max_attempts}` : ""}
            </span>
            <span style={{ marginLeft: "auto" }}>
              {startedAtValue ? timeAgo(startedAtValue) : "Waiting for job metadata"}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              height: 6,
              borderRadius: 999,
              background: "var(--bg)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: "100%",
                background: statusColor,
                opacity: 0.38,
              }}
            />
          </div>
        </>
      }
      body={
        <div
          style={{
            background: "#0b0f17",
            borderRadius: 10,
            border: "1px solid #1f2937",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "9px 13px",
              background: "#0f172a",
              borderBottom: "1px solid #1f2937",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            <span>Durable worker</span>
            <span style={{ color: statusColor }}>{statusLabel}</span>
          </div>
          <div
            style={{
              padding: "15px 16px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.7,
              color: "#cbd5e1",
              minHeight: 180,
            }}
          >
            {eventLines.map((line, index) => (
              <Line key={`${line.text}-${index}`} line={line} />
            ))}
          </div>
        </div>
      }
      actions={
        <>
          <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            Status refreshes from the durable queue every 10 seconds. This browser never advances jobs.
          </span>
        </>
      }
    />
  );
}

function Line({ line }: { line: SandboxLine }) {
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
  return (
    <div
      style={{
        color,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        display: "flex",
        gap: 8,
      }}
    >
      <span style={{ minWidth: 0 }}>{line.text}</span>
    </div>
  );
}

// ─── Stage B: Review Panel (scorecard + approve/reject) ──────────────────

function ReviewPanel({
  submission,
  onApprove,
  onReject,
}: {
  submission: SubmissionRecord;
  onApprove: (submission: SubmissionRecord) => Promise<void>;
  onReject: (submission: SubmissionRecord, reason: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirming, setConfirming] = useState<null | "approve">(null);
  const [pendingAction, setPendingAction] = useState<null | "approve" | "reject">(null);
  const m = submission.metrics;
  const hasMetrics = submission.metrics_available === true;
  const color = hasMetrics ? scoreColor(m.confidence) : "var(--muted)";

  async function doApprove() {
    setPendingAction("approve");
    try {
      await onApprove(submission);
      setConfirming(null);
    } finally {
      setPendingAction(null);
    }
  }

  async function doReject() {
    if (!rejectReason.trim()) return;
    setPendingAction("reject");
    try {
      await onReject(submission, rejectReason.trim());
      setRejecting(false);
      setRejectReason("");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <DetailFrame
      header={<DetailHeader submission={submission} />}
      body={
        <>
          {/* Score + metric chips row */}
          {hasMetrics ? <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 16,
              padding: "14px 16px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              marginBottom: 16,
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 14,
                background: color,
                color: "#fff",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 28,
                  lineHeight: 1,
                }}
              >
                {m.confidence}
              </div>
              <div
                style={{
                  fontSize: 9,
                  fontFamily: "var(--font-mono)",
                  marginTop: 2,
                  opacity: 0.92,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                / 100
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: 12,
              }}
            >
              <Chip
                label="Endpoints"
                value={`${m.endpoints_passing}/${m.endpoints_total}`}
                ok={m.endpoints_passing === m.endpoints_total}
              />
              <Chip label="I/O" value={`${m.io_match_pct}%`} ok={m.io_match_pct >= 90} />
              <Chip
                label="p95 latency"
                value={`${m.p95_response_ms}ms`}
                ok={m.p95_response_ms < 250}
              />
              <Chip
                label="Security"
                value={`${m.security.critical}c · ${m.security.medium}m`}
                ok={m.security.critical === 0 && m.security.medium <= 1}
              />
            </div>
          </div> : (
            <div
              style={{
                padding: "14px 16px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                marginBottom: 16,
                color: "var(--muted)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              No measured quality report is stored for this tool. Review its repository, runtime
              configuration, and declared I/O contract directly; zero values are intentionally not
              presented as test results.
            </div>
          )}

          {/* Endpoint results table */}
          {submission.endpoint_results && submission.endpoint_results.length > 0 && (
            <Section title="Endpoint results">
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  overflow: "hidden",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg)" }}>
                      <Th>Method</Th>
                      <Th>Path</Th>
                      <Th align="right">Status</Th>
                      <Th align="right">Latency</Th>
                      <Th align="right">Result</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {submission.endpoint_results.map((r, i) => (
                      <tr
                        key={`${r.method}-${r.path}-${i}`}
                        style={{ borderTop: "1px solid var(--border)" }}
                      >
                        <Td bold>{r.method}</Td>
                        <Td>{r.path}</Td>
                        <Td align="right">{r.status}</Td>
                        <Td align="right">{r.latency_ms}ms</Td>
                        <Td align="right" color={r.passed ? "#16a34a" : "#dc2626"}>
                          {r.passed ? "✓ PASS" : "✗ FAIL"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* I/O contract */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <ContractBox label="Inputs" body={submission.inputs} />
            <ContractBox label="Outputs" body={submission.outputs} />
          </div>

          {/* Code quality findings */}
          {hasMetrics && <Section title="Code quality">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 10,
              }}
            >
              <Finding
                label="Documentation"
                value={m.docs_quality}
                mark={
                  m.docs_quality === "Good"
                    ? "ok"
                    : m.docs_quality === "Fair"
                      ? "warn"
                      : "err"
                }
              />
              <Finding
                label="Test coverage"
                value={`${m.test_coverage_pct}%`}
                mark={
                  m.test_coverage_pct >= 60
                    ? "ok"
                    : m.test_coverage_pct >= 30
                      ? "warn"
                      : "err"
                }
              />
              <Finding
                label="Dependencies"
                value={`${m.deps_total} (${m.deps_vulnerable} CVE)`}
                mark={
                  m.deps_vulnerable === 0
                    ? "ok"
                    : m.deps_vulnerable <= 2
                      ? "warn"
                      : "err"
                }
              />
              <Finding
                label="Rate limiting"
                value={m.rate_limiting ? "Implemented" : "Not implemented"}
                mark={m.rate_limiting ? "ok" : "warn"}
              />
              <Finding
                label="REST conventions"
                value={m.rest_conventions ? "Followed" : "Non-standard"}
                mark={m.rest_conventions ? "ok" : "warn"}
              />
              <Finding
                label="Error handling"
                value={m.consistent_errors ? "Consistent" : "Inconsistent"}
                mark={m.consistent_errors ? "ok" : "warn"}
              />
            </div>
          </Section>}

          {/* Reject form, if open */}
          {rejecting && (
            <div
              style={{
                marginTop: 4,
                padding: 12,
                background: "rgba(220,38,38,0.06)",
                border: "1px solid rgba(220,38,38,0.18)",
                borderRadius: 10,
              }}
            >
              <Eyebrow style={{ color: "#dc2626" }}>Reject with reason</Eyebrow>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="What needs to change before resubmission?"
                rows={3}
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  fontSize: 13,
                  color: "var(--text)",
                  fontFamily: "var(--font-body)",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    setRejecting(false);
                    setRejectReason("");
                  }}
                  style={ghostBtnStyle}
                >
                  Cancel
                </button>
                <button
                  onClick={doReject}
                  disabled={!rejectReason.trim() || pendingAction === "reject"}
                  style={{ ...dangerBtnStyle, opacity: rejectReason.trim() && pendingAction !== "reject" ? 1 : 0.5 }}
                >
                  {pendingAction === "reject" ? "Sending…" : "Send rejection"}
                </button>
              </div>
            </div>
          )}

          {/* Approve confirm */}
          {confirming === "approve" && (
            <div
              style={{
                marginTop: 4,
                padding: 12,
                background: "rgba(22,163,74,0.06)",
                border: "1px solid rgba(22,163,74,0.18)",
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
                Approve <strong>{submission.name}</strong>? This will list it on the
                marketplace immediately. No notification is sent automatically.
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setConfirming(null)} style={ghostBtnStyle}>
                  Cancel
                </button>
                <button
                  onClick={() => void doApprove()}
                  disabled={pendingAction === "approve"}
                  style={{ ...approveBtnStyle, opacity: pendingAction === "approve" ? 0.6 : 1 }}
                >
                  {pendingAction === "approve" ? "Approving…" : "Yes, approve"}
                </button>
              </div>
            </div>
          )}
        </>
      }
      actions={
        <>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              setRejecting(true);
              setConfirming(null);
            }}
            style={dangerBtnStyle}
          >
            ✗ Reject
          </button>
          <button
            onClick={() => setConfirming("approve")}
            disabled={pendingAction !== null}
            style={{ ...approveBtnStyle, opacity: pendingAction ? 0.6 : 1 }}
          >
            ✓ Approve
          </button>
        </>
      }
    />
  );
}

// ─── Stage C: Live Panel (verified monitoring + revoke) ─────────────────

function LivePanel({
  submission,
  onRevoke,
}: {
  submission: SubmissionRecord;
  onRevoke: (submission: SubmissionRecord, reason: string) => Promise<void>;
}) {
  const live = submission.live;
  const hasUptime = typeof live?.uptime_pct === "number";
  const hasHealth = Boolean(live?.health && live.health !== "unknown");
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokePending, setRevokePending] = useState(false);

  async function doRevoke() {
    if (!revokeReason.trim()) return;
    setRevokePending(true);
    try {
      await onRevoke(submission, revokeReason.trim());
      setRevoking(false);
      setRevokeReason("");
    } finally {
      setRevokePending(false);
    }
  }

  if (!live) {
    return (
      <DetailFrame
        header={<DetailHeader submission={submission} />}
        body={
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            This tool is listed, but the API did not return its listing details. Refresh the page
            before managing access.
          </div>
        }
      />
    );
  }

  return (
    <DetailFrame
      header={<DetailHeader submission={submission} />}
      body={
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <StatTile
              label="All-time calls"
              value={live.api_calls_total.toLocaleString()}
              sub="recorded by the gateway"
            />
            <StatTile
              label="Last updated"
              value={timeAgo(live.last_updated_at)}
              sub={new Date(live.last_updated_at).toLocaleDateString()}
            />
            <StatTile
              label="Uptime"
              value={hasUptime ? `${live.uptime_pct!.toFixed(2)}%` : "Not measured"}
              sub={hasUptime ? "reported by the API" : "monitoring not connected"}
              color={
                hasUptime
                  ? live.uptime_pct! >= 99.9
                    ? "#16a34a"
                    : "#d97706"
                  : "var(--muted)"
              }
            />
            <StatTile
              label="Health"
              value={
                hasHealth && live.health
                  ? live.health.charAt(0).toUpperCase() + live.health.slice(1)
                  : "Not measured"
              }
              sub={hasHealth ? "latest monitoring result" : "health checks not connected"}
              color={
                hasHealth && live.health === "healthy"
                  ? "#16a34a"
                  : "var(--muted)"
              }
            />
          </div>

          {(!hasUptime || !hasHealth) && (
            <Section title="Production telemetry">
              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--muted)",
                }}
              >
                The gateway currently provides the all-time request count. Uptime, active installs,
                weekly revenue, and customer feedback are omitted until their production data
                sources are connected.
              </div>
            </Section>
          )}

          {/* Revoke form */}
          {revoking && (
            <div
              style={{
                marginTop: 4,
                padding: 12,
                background: "rgba(220,38,38,0.06)",
                border: "1px solid rgba(220,38,38,0.18)",
                borderRadius: 10,
              }}
            >
              <Eyebrow style={{ color: "#dc2626" }}>Revoke access</Eyebrow>
              <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>
                Removes <strong>{submission.name}</strong> from the marketplace. Active
                integrations will receive 401 errors. The reason is stored with the tool for
                review; no notification is sent automatically.
              </p>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Reason for revocation (e.g., ToS violation, security finding)…"
                rows={3}
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  fontSize: 13,
                  color: "var(--text)",
                  fontFamily: "var(--font-body)",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    setRevoking(false);
                    setRevokeReason("");
                  }}
                  style={ghostBtnStyle}
                >
                  Cancel
                </button>
                <button
                  onClick={doRevoke}
                  disabled={!revokeReason.trim() || revokePending}
                  style={{ ...dangerBtnStyle, opacity: revokeReason.trim() && !revokePending ? 1 : 0.5 }}
                >
                  {revokePending ? "Revoking…" : "Confirm revoke"}
                </button>
              </div>
            </div>
          )}
        </>
      }
      actions={
        <>
          <Link
            href={`/tools/${submission.slug}`}
            style={ghostBtnStyle as React.CSSProperties}
          >
            View listing ↗
          </Link>
          <div style={{ flex: 1 }} />
          <button onClick={() => setRevoking(true)} style={dangerBtnStyle}>
            Revoke access
          </button>
        </>
      }
    />
  );
}

// ─── Archived (rejected/revoked) ──────────────────────────────────────────

function ArchivedPanel({ submission }: { submission: SubmissionRecord }) {
  const label = submission.stage === "rejected" ? "Rejected" : "Revoked";
  return (
    <DetailFrame
      header={<DetailHeader submission={submission} />}
      body={
        <div
          style={{
            padding: 16,
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            borderRadius: 10,
            color: "var(--text)",
          }}
        >
          <Eyebrow style={{ color: "#dc2626" }}>{label}</Eyebrow>
          <p style={{ marginTop: 8, fontSize: 14 }}>
            {submission.rejection_reason ?? "No reason recorded."}
          </p>
        </div>
      }
    />
  );
}

// ─── Reusable bits ────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Eyebrow style={{ marginBottom: 8 }}>{title}</Eyebrow>
      {children}
    </div>
  );
}

function ContractBox({ label, body }: { label: string; body: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <Eyebrow>{label}</Eyebrow>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--text)",
          marginTop: 6,
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function Chip({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div>
      <Eyebrow style={{ fontSize: 10 }}>{label}</Eyebrow>
      <div
        style={{
          color: ok ? "#16a34a" : "#d97706",
          fontWeight: 600,
          fontSize: 14,
          marginTop: 2,
        }}
      >
        {ok ? "✓ " : "⚠ "}
        {value}
      </div>
    </div>
  );
}

function Finding({
  label,
  value,
  mark,
}: {
  label: string;
  value: string;
  mark: "ok" | "warn" | "err";
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <span
        style={{
          color:
            mark === "ok" ? "#16a34a" : mark === "warn" ? "#d97706" : "#dc2626",
          fontWeight: 700,
          fontSize: 14,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {mark === "ok" ? "✓" : mark === "warn" ? "⚠" : "✗"}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "var(--text)", fontSize: 13 }}>{label}</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{value}</div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <Eyebrow style={{ fontSize: 10 }}>{label}</Eyebrow>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 19,
          color: color ?? "var(--text)",
          marginTop: 4,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Pill({
  children,
  bg,
  fg,
}: {
  children: ReactNode;
  bg: string;
  fg: string;
}) {
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function Eyebrow({
  children,
  style,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Sep() {
  return <span style={{ color: "var(--faint)" }}>·</span>;
}

function Centered({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 60,
        textAlign: "center",
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}

function Toast({ children }: { children: ReactNode }) {
  return (
    <div
      className="hm-toast"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "var(--card)",
        border: "1px solid var(--border)",
        padding: "12px 18px",
        borderRadius: 12,
        boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
        fontSize: 13.5,
        color: "var(--text)",
        zIndex: 100,
      }}
    >
      {children}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--muted)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  bold,
  color,
}: {
  children: ReactNode;
  align?: "left" | "right";
  bold?: boolean;
  color?: string;
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        textAlign: align,
        color: color ?? "var(--text)",
        fontWeight: bold ? 600 : 400,
        fontFamily: "var(--font-mono)",
      }}
    >
      {children}
    </td>
  );
}

// ─── Auth and queue states ───────────────────────────────────────────────

function AccessGate({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <PageShell>
      <div
        style={{
          maxWidth: 420,
          margin: "60px auto 0",
          padding: 32,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
        }}
      >
        <Eyebrow style={{ color: "var(--blue)" }}>Admin access</Eyebrow>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--text)",
            margin: "10px 0 6px",
          }}
        >
          {title}
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>
          {body}
        </p>
        {action ? <div style={{ display: "flex" }}>{action}</div> : null}
      </div>
    </PageShell>
  );
}

function QueueError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        padding: 28,
        color: "var(--muted)",
      }}
    >
      <Eyebrow style={{ color: "#dc2626" }}>Queue unavailable</Eyebrow>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 20,
          color: "var(--text)",
          margin: "8px 0 6px",
        }}
      >
        Could not load the live review queue
      </h2>
      <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>{message}</p>
      <button onClick={onRetry} style={primaryBtnStyle}>
        Retry
      </button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function scoreColor(n: number): string {
  if (n >= 80) return "#16a34a";
  if (n >= 60) return "#d97706";
  return "#dc2626";
}

function timeAgo(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// ─── Button styles ────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  background: "var(--blue)",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  border: "none",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const approveBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: "#16a34a",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  background: "#fff",
  color: "#dc2626",
  border: "1px solid rgba(220,38,38,0.4)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
