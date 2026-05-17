"use client";

// Approver Dashboard — dense, viewport-fitting layout with three stages:
//
//   STAGE A — testing in progress (live CI-pipeline visualization)
//   STAGE B — review ready (scorecard + approve/reject + PDF report)
//   STAGE C — listed & live (uptime / installs / reviews + revoke/alert)
//
// Layout: two-column on ≥1280px (queue 360px · detail flex), single column
// stacking on narrow viewports. Both panels are bounded to viewport height
// so the action buttons stay visible without scrolling.

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  approveSubmission,
  buildLiveTestPlan,
  completeTesting,
  getSubmission,
  liveTestDurationMs,
  listSubmissions,
  revokeSubmission,
  updateSubmission,
  type LiveTestStage,
  type SandboxLine,
  type SubmissionRecord,
  type SubmissionStage,
} from "@/lib/submissions";
import { downloadReport, reportBlobUrl } from "@/lib/pdfReport";

const ADMIN_TOKEN = "admin";

// ─── Auth wrapper ─────────────────────────────────────────────────────────

export default function ApproverClient() {
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const param = url.searchParams.get("token");
    const stored = window.sessionStorage.getItem("hackmarket.admin.token");
    if (param === ADMIN_TOKEN || stored === ADMIN_TOKEN) {
      window.sessionStorage.setItem("hackmarket.admin.token", ADMIN_TOKEN);
      setAuthed(true);
    }
    setAuthChecked(true);
  }, []);

  if (!authChecked) {
    return (
      <PageShell>
        <Centered text="Checking access…" />
      </PageShell>
    );
  }

  if (!authed) {
    return <AuthGate onAuth={() => setAuthed(true)} />;
  }

  return <Dashboard />;
}

// ─── Dashboard ────────────────────────────────────────────────────────────

function Dashboard() {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const submissions = useMemo<SubmissionRecord[]>(() => {
    void tick;
    return listSubmissions();
  }, [tick]);

  const testing = submissions.filter((s) => s.stage === "testing");
  const reviewQueue = submissions.filter((s) => s.stage === "manual_review");
  const live = submissions.filter((s) => s.stage === "listed");

  // Default focus: first review-ready, then testing, then live.
  const defaultFocusId =
    reviewQueue[0]?.id ?? testing[0]?.id ?? live[0]?.id ?? null;
  const [focusId, setFocusId] = useState<string | null>(defaultFocusId);

  useEffect(() => {
    const url = new URL(window.location.href);
    const f = url.searchParams.get("focus");
    if (f) setFocusId(f);
  }, []);

  // Tick when nothing focused (re-evaluate after a list change).
  useEffect(() => {
    if (!focusId && defaultFocusId) setFocusId(defaultFocusId);
  }, [focusId, defaultFocusId]);

  const focused = focusId ? getSubmission(focusId) : null;

  const [toast, setToast] = useState<string | null>(null);
  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
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
                onCompleted={() => {
                  refresh();
                  // Switch focus to it now that it's review-ready.
                  setFocusId(s.id);
                  flash(`${s.name} automated tests complete — ready for review.`);
                }}
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
              <TestingPanel submission={focused} onCompleted={refresh} />
            ) : focused.stage === "manual_review" ? (
              <ReviewPanel submission={focused} onAction={refresh} flash={flash} />
            ) : focused.stage === "listed" ? (
              <LivePanel submission={focused} onAction={refresh} flash={flash} />
            ) : (
              <ArchivedPanel submission={focused} />
            )
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
        paddingTop: 80,
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
        alignItems: "flex-end",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 16,
      }}
    >
      <div>
        <Eyebrow>Approver dashboard</Eyebrow>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 26,
            color: "var(--text)",
            margin: "10px 0 4px",
            letterSpacing: "-0.01em",
          }}
        >
          {counts.review} pending review
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
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

function TestingCard({
  submission,
  focused,
  onClick,
  onCompleted,
}: CardProps & { onCompleted: () => void }) {
  // Tick a 1s timer while the card is mounted so the elapsed display updates.
  const [, setNow] = useState(0);
  const startedAt = submission.testing_started_at
    ? new Date(submission.testing_started_at).getTime()
    : new Date(submission.submitted_at).getTime();
  const total = liveTestDurationMs(submission);

  useEffect(() => {
    const i = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  // Auto-complete when the timer is up.
  useEffect(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = total - elapsed;
    if (remaining <= 0) {
      completeTesting(submission.id);
      onCompleted();
      return;
    }
    const t = setTimeout(() => {
      completeTesting(submission.id);
      onCompleted();
    }, remaining);
    return () => clearTimeout(t);
  }, [startedAt, total, submission.id, onCompleted]);

  const elapsed = Math.max(0, Date.now() - startedAt);
  const pct = Math.min(99, Math.round((elapsed / total) * 100));
  const eta = Math.max(0, Math.ceil((total - elapsed) / 1000));

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
              background: "rgba(99,102,241,0.14)",
              color: "#6366f1",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            <span className="appr-pulse" />
            Testing…
          </span>
        }
      />
      <CardSub>
        {submission.tech_stack.slice(0, 2).join(" + ") || submission.language}{" "}
        · ETA {eta}s
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
            background: "#6366f1",
            width: `${pct}%`,
            transition: "width 0.6s linear",
          }}
        />
      </div>
    </CardShell>
  );
}

function ReviewCard({ submission, focused, onClick }: CardProps) {
  const m = submission.metrics;
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
              color: scoreColor(m.confidence),
            }}
          >
            {m.confidence}/100
          </span>
        }
      />
      <CardSub>
        <span>{submission.tech_stack.slice(0, 2).join(" + ") || submission.language}</span>
        <span style={{ marginLeft: "auto" }}>{timeAgo(submission.submitted_at)}</span>
      </CardSub>
      <CardSub style={{ fontSize: 11 }}>
        {m.endpoints_passing}/{m.endpoints_total} pass · p95 {m.p95_response_ms}ms
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
              background:
                live?.health === "healthy"
                  ? "rgba(22,163,74,0.12)"
                  : "rgba(217,119,6,0.14)",
              color: live?.health === "healthy" ? "#16a34a" : "#d97706",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            ● {live?.uptime_pct?.toFixed(2) ?? "—"}%
          </span>
        }
      />
      <CardSub>
        <span>{live?.installs ?? 0} installs</span>
        <span style={{ marginLeft: "auto" }}>
          ${(live?.earnings_cents_7d ?? 0) / 100}/wk
        </span>
      </CardSub>
      <CardSub style={{ fontSize: 11 }}>
        {(live?.api_calls_7d ?? 0).toLocaleString()} calls last 7d
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
        {name}
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
        {submission.name}
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
        <a
          href={submission.github_url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--blue)", textDecoration: "none" }}
        >
          repo ↗
        </a>
        <Sep />
        <span style={{ fontFamily: "var(--font-mono)" }}>{submission.submitter_email}</span>
      </div>
    </>
  );
}

// ─── Stage A: Testing Panel (live CI-pipeline-style monitor) ─────────────

function TestingPanel({
  submission,
  onCompleted,
}: {
  submission: SubmissionRecord;
  onCompleted: () => void;
}) {
  const plan: LiveTestStage[] = useMemo(
    () => buildLiveTestPlan(submission),
    [submission],
  );

  const startedAt = submission.testing_started_at
    ? new Date(submission.testing_started_at).getTime()
    : Date.now();

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);

  // Compute current stage and stage-relative elapsed.
  const totalElapsed = Math.max(0, now - startedAt);
  let acc = 0;
  let stageIdx = 0;
  let stageElapsed = 0;
  for (let i = 0; i < plan.length; i++) {
    if (totalElapsed < acc + plan[i].ms) {
      stageIdx = i;
      stageElapsed = totalElapsed - acc;
      break;
    }
    acc += plan[i].ms;
    stageIdx = i + 1;
    stageElapsed = 0;
  }

  const totalDuration = liveTestDurationMs(submission);
  const overallPct = Math.min(100, Math.round((totalElapsed / totalDuration) * 100));

  // Auto-complete when finished.
  useEffect(() => {
    if (totalElapsed >= totalDuration) {
      completeTesting(submission.id);
      onCompleted();
    }
  }, [totalElapsed, totalDuration, submission.id, onCompleted]);

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
                background: "rgba(99,102,241,0.14)",
                color: "#6366f1",
                fontWeight: 600,
              }}
            >
              <span className="appr-pulse-large" /> LIVE
            </span>
            <span>
              Stage {Math.min(stageIdx + 1, plan.length)} of {plan.length}:{" "}
              {plan[Math.min(stageIdx, plan.length - 1)]?.name}
            </span>
            <span style={{ marginLeft: "auto" }}>
              {Math.round(totalElapsed / 1000)}s / {Math.round(totalDuration / 1000)}s
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
                width: `${overallPct}%`,
                background: "linear-gradient(90deg, #6366f1, #a5b4fc)",
                transition: "width 0.3s linear",
              }}
            />
          </div>
        </>
      }
      body={
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 18 }}>
          {/* Stage tracker */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: 12.5,
              fontFamily: "var(--font-mono)",
            }}
          >
            {plan.map((s, i) => {
              const done = i < stageIdx;
              const active = i === stageIdx;
              return (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: done
                      ? "#16a34a"
                      : active
                        ? "var(--text)"
                        : "var(--muted)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      border: `2px solid ${
                        done
                          ? "#16a34a"
                          : active
                            ? "#6366f1"
                            : "var(--border)"
                      }`,
                      background: done ? "#16a34a" : "transparent",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 10,
                      flexShrink: 0,
                      animation: active ? "apprPulse 1.6s ease-in-out infinite" : undefined,
                    }}
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Terminal-style live output */}
          <LiveTerminal plan={plan} stageIdx={stageIdx} stageElapsed={stageElapsed} />
        </div>
      }
      actions={
        <>
          <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            Auto-promotes to manual review when testing completes.
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              completeTesting(submission.id);
              onCompleted();
            }}
            style={ghostBtnStyle}
          >
            Skip → review now
          </button>
        </>
      }
    />
  );
}

function LiveTerminal({
  plan,
  stageIdx,
  stageElapsed,
}: {
  plan: LiveTestStage[];
  stageIdx: number;
  stageElapsed: number;
}) {
  const safeIdx = Math.min(stageIdx, plan.length - 1);

  // Lines visible: all completed stages' lines + the current stage's lines up
  // to the elapsed cumulative delay.
  const visible: { stage: number; line: SandboxLine; key: string }[] = [];
  for (let i = 0; i < safeIdx; i++) {
    plan[i].lines.forEach((line, j) => {
      visible.push({ stage: i, line, key: `${i}-${j}` });
    });
  }
  // Within current stage, walk delays cumulatively.
  if (safeIdx < plan.length) {
    let cum = 0;
    plan[safeIdx].lines.forEach((line, j) => {
      cum += line.delay ?? 220;
      if (cum <= stageElapsed) {
        visible.push({ stage: safeIdx, line, key: `${safeIdx}-${j}` });
      }
    });
  }

  // Auto-scroll the terminal to the bottom as lines arrive.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  return (
    <div
      style={{
        background: "#0b0f17",
        borderRadius: 10,
        border: "1px solid #1f2937",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 280,
      }}
    >
      <div
        style={{
          padding: "8px 12px",
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
        <span>sandbox.{plan[safeIdx]?.name.toLowerCase().replace(/\s+/g, "-")}</span>
        <span style={{ color: "#ef4444", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span className="appr-pulse-rec" /> LIVE
        </span>
      </div>
      <div
        ref={ref}
        style={{
          padding: "12px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.6,
          color: "#cbd5e1",
          flex: 1,
          overflowY: "auto",
          minHeight: 240,
          maxHeight: 340,
        }}
      >
        {visible.map((v) => (
          <Line key={v.key} line={v.line} />
        ))}
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
    </div>
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
    <div style={{ color, whiteSpace: "pre" }}>
      {line.text.startsWith(" ") ? "" : "$ "}
      {line.text}
    </div>
  );
}

// ─── Stage B: Review Panel (scorecard + approve/reject) ──────────────────

function ReviewPanel({
  submission,
  onAction,
  flash,
}: {
  submission: SubmissionRecord;
  onAction: () => void;
  flash: (msg: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirming, setConfirming] = useState<null | "approve">(null);
  const m = submission.metrics;
  const color = scoreColor(m.confidence);

  function doApprove() {
    approveSubmission(submission.id);
    setConfirming(null);
    flash(`Approved ${submission.name} — now live on the marketplace.`);
    onAction();
  }

  function doReject() {
    if (!rejectReason.trim()) return;
    updateSubmission(submission.id, {
      stage: "rejected",
      rejection_reason: rejectReason.trim(),
    });
    setRejecting(false);
    setRejectReason("");
    flash(`Rejected ${submission.name}.`);
    onAction();
  }

  return (
    <DetailFrame
      header={<DetailHeader submission={submission} />}
      body={
        <>
          {/* Score + metric chips row */}
          <div
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
          </div>

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
          <Section title="Code quality">
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
          </Section>

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
                  disabled={!rejectReason.trim()}
                  style={{ ...dangerBtnStyle, opacity: rejectReason.trim() ? 1 : 0.5 }}
                >
                  Send rejection
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
                marketplace and notify the submitter.
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setConfirming(null)} style={ghostBtnStyle}>
                  Cancel
                </button>
                <button onClick={doApprove} style={approveBtnStyle}>
                  Yes, approve
                </button>
              </div>
            </div>
          )}
        </>
      }
      actions={
        <>
          <button
            onClick={() => downloadReport(submission)}
            style={primaryBtnStyle}
          >
            📄 Download PDF report
          </button>
          <button
            onClick={() => window.open(reportBlobUrl(submission), "_blank")}
            style={ghostBtnStyle}
          >
            Preview ↗
          </button>
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
          <button onClick={() => setConfirming("approve")} style={approveBtnStyle}>
            ✓ Approve
          </button>
        </>
      }
    />
  );
}

// ─── Stage C: Live Panel (monitoring + revoke + alert creator) ───────────

function LivePanel({
  submission,
  onAction,
  flash,
}: {
  submission: SubmissionRecord;
  onAction: () => void;
  flash: (msg: string) => void;
}) {
  const live = submission.live!;
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  function doRevoke() {
    if (!revokeReason.trim()) return;
    revokeSubmission(submission.id, revokeReason.trim());
    setRevoking(false);
    setRevokeReason("");
    flash(`Revoked ${submission.name}.`);
    onAction();
  }

  return (
    <DetailFrame
      header={<DetailHeader submission={submission} />}
      body={
        <>
          {/* Live stats row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <StatTile
              label="Uptime"
              value={`${live.uptime_pct.toFixed(2)}%`}
              sub={`${live.uptime_window_days}d window`}
              color={live.uptime_pct >= 99.9 ? "#16a34a" : "#d97706"}
            />
            <StatTile
              label="Installs"
              value={live.installs.toLocaleString()}
              sub="active customers"
            />
            <StatTile
              label="API calls"
              value={(live.api_calls_7d / 1000).toFixed(1) + "k"}
              sub="last 7d"
            />
            <StatTile
              label="Earnings"
              value={`$${(live.earnings_cents_7d / 100).toFixed(2)}`}
              sub="last 7d"
              color="#16a34a"
            />
            <StatTile
              label="Listed since"
              value={timeAgo(live.listed_at)}
              sub={new Date(live.listed_at).toLocaleDateString()}
            />
            <StatTile
              label="Health"
              value={live.health.charAt(0).toUpperCase() + live.health.slice(1)}
              sub={live.health === "healthy" ? "all checks pass" : "investigate"}
              color={live.health === "healthy" ? "#16a34a" : "#d97706"}
            />
          </div>

          {/* Feedback summary */}
          {live.feedback_summary && (
            <Section title="Feedback summary">
              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--text)",
                }}
              >
                {live.feedback_summary}
              </div>
            </Section>
          )}

          {/* User reviews */}
          <Section title={`User reviews & requests (${live.reviews.length})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {live.reviews.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: 13, padding: 8 }}>
                  No reviews yet.
                </div>
              ) : (
                live.reviews.map((r, i) => (
                  <div
                    key={`${r.user}-${i}`}
                    style={{
                      padding: "10px 14px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                        {r.user}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--muted)",
                        }}
                      >
                        {"★".repeat(r.rating)}
                        <span style={{ opacity: 0.3 }}>{"★".repeat(5 - r.rating)}</span>
                      </span>
                      {r.is_feature_request && (
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(99,102,241,0.14)",
                            color: "#6366f1",
                            fontFamily: "var(--font-mono)",
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          Feature request
                        </span>
                      )}
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          color: "var(--muted)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {timeAgo(r.posted_at)} ago
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--muted)",
                        lineHeight: 1.5,
                      }}
                    >
                      {r.comment}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Section>

          {/* Alert creator compose */}
          {composeOpen && (
            <Section title="Alert creator">
              <ComposeAlert
                submission={submission}
                onSent={() => {
                  setComposeOpen(false);
                  flash(`Sent summary to ${submission.submitter_email}.`);
                }}
                onCancel={() => setComposeOpen(false)}
              />
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
                Removes <strong>{submission.name}</strong> from the marketplace.
                Active integrations will receive 401 errors. Confirm with a reason
                that will be sent to {submission.submitter_email}.
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
                  disabled={!revokeReason.trim()}
                  style={{ ...dangerBtnStyle, opacity: revokeReason.trim() ? 1 : 0.5 }}
                >
                  Confirm revoke
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
          <button onClick={() => downloadReport(submission)} style={ghostBtnStyle}>
            📄 PDF
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setComposeOpen((v) => !v)}
            style={primaryBtnStyle}
          >
            ✉ Alert creator
          </button>
          <button onClick={() => setRevoking(true)} style={dangerBtnStyle}>
            ✗ Revoke access
          </button>
        </>
      }
    />
  );
}

function ComposeAlert({
  submission,
  onSent,
  onCancel,
}: {
  submission: SubmissionRecord;
  onSent: () => void;
  onCancel: () => void;
}) {
  const live = submission.live!;
  const requests = live.reviews.filter((r) => r.is_feature_request);
  const defaultBody = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Hi,`);
    lines.push("");
    lines.push(
      `Quick update from the Hackmarket review team on ${submission.name}. ` +
        `Strong adoption this week — ${(live.api_calls_7d).toLocaleString()} calls ` +
        `across ${live.installs} installs and ${live.uptime_pct.toFixed(2)}% uptime.`,
    );
    lines.push("");
    if (requests.length > 0) {
      lines.push("Recurring feature requests from users:");
      for (const r of requests.slice(0, 5)) {
        lines.push(`  • ${r.user}: ${r.comment}`);
      }
      lines.push("");
      lines.push(
        "Worth considering for the next release — these are the most-mentioned gaps and would likely lift retention.",
      );
    } else {
      lines.push(
        "No specific feature requests stood out this week — happy customers all around. Keep an eye on response time during peak hours.",
      );
    }
    lines.push("");
    lines.push("Reach out if you'd like to talk through any of this.");
    lines.push("— Hackmarket Review Team");
    return lines.join("\n");
  }, [submission.name, live, requests]);

  const [body, setBody] = useState(defaultBody);

  return (
    <div
      style={{
        padding: 12,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", gap: 12, fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
        <span>
          <strong style={{ color: "var(--text)" }}>To:</strong>{" "}
          {submission.submitter_email}
        </span>
        <span>
          <strong style={{ color: "var(--text)" }}>Subject:</strong>{" "}
          {submission.name} — weekly feedback summary
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--card)",
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          color: "var(--text)",
          resize: "vertical",
          lineHeight: 1.55,
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={ghostBtnStyle}>
          Cancel
        </button>
        <button onClick={onSent} style={primaryBtnStyle}>
          Send →
        </button>
      </div>
    </div>
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

// ─── Auth gate ───────────────────────────────────────────────────────────

function AuthGate({ onAuth }: { onAuth: () => void }) {
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
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
          Reviewer login
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>
          Enter the admin token to access the approver queue. (Demo token:{" "}
          <code>admin</code>)
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tokenInput === ADMIN_TOKEN) {
              window.sessionStorage.setItem(
                "hackmarket.admin.token",
                ADMIN_TOKEN,
              );
              onAuth();
            } else {
              setAuthError("Invalid token.");
            }
          }}
        >
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              setAuthError("");
            }}
            placeholder="Token"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${authError ? "#dc2626" : "var(--border)"}`,
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "var(--font-mono)",
            }}
          />
          {authError && (
            <div style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>
              {authError}
            </div>
          )}
          <button
            type="submit"
            style={{
              marginTop: 14,
              width: "100%",
              padding: "10px",
              borderRadius: 8,
              background: "var(--blue)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              border: "none",
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
        </form>
      </div>
    </PageShell>
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
