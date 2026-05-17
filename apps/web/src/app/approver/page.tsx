"use client";

// Approver Dashboard — reviews submissions waiting for human sign-off.
// Backed by the local submissions store; each submission can be inspected,
// a PDF API Quality Report can be downloaded, and the approver can
// approve (→ "listed") or reject (→ "rejected" with reason).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getSubmission,
  listSubmissions,
  updateSubmission,
  type SubmissionRecord,
  type SubmissionStage,
} from "@/lib/submissions";
import { downloadReport, reportBlobUrl } from "@/lib/pdfReport";

const ADMIN_TOKEN = "admin";

function timeAgo(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function scoreColor(n: number): string {
  if (n >= 80) return "#16a34a";
  if (n >= 60) return "#d97706";
  return "#dc2626";
}

export default function ApproverPage() {
  // ─── Auth gate (URL token or prompt) ──────────────────────────────────
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");

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

  // ─── Data ─────────────────────────────────────────────────────────────
  const [tick, setTick] = useState(0);
  const submissions = useMemo<SubmissionRecord[]>(() => {
    void tick;
    return listSubmissions();
  }, [tick]);

  // Show submissions awaiting review (manual_review) at the top, then any
  // that have moved past it (listed/approved/rejected) so the approver can
  // see their recent actions.
  const queue = submissions.filter((s) => s.stage === "manual_review");
  const recent = submissions.filter(
    (s) =>
      s.stage === "listed" ||
      s.stage === "approved" ||
      s.stage === "rejected",
  );

  // ─── Focused submission ───────────────────────────────────────────────
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const focus = url.searchParams.get("focus");
    if (focus) setFocusId(focus);
    else if (queue.length > 0) setFocusId(queue[0].id);
  }, [queue.length]);
  const focused = focusId ? getSubmission(focusId) : null;

  // ─── Approve / reject ─────────────────────────────────────────────────
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirming, setConfirming] = useState<null | "approve" | "reject">(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function doApprove() {
    if (!focused) return;
    updateSubmission(focused.id, { stage: "listed" });
    setConfirming(null);
    flash(`Approved ${focused.name} — now live on the marketplace.`);
    setTick((t) => t + 1);
  }

  function doReject() {
    if (!focused || !rejectReason.trim()) return;
    updateSubmission(focused.id, {
      stage: "rejected",
      rejection_reason: rejectReason.trim(),
    });
    setConfirming(null);
    setRejecting(false);
    setRejectReason("");
    flash(`Rejected ${focused.name}.`);
    setTick((t) => t + 1);
  }

  // ─── Auth gate UI ─────────────────────────────────────────────────────
  if (!authChecked) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          paddingTop: 120,
          textAlign: "center",
          color: "var(--muted)",
        }}
      >
        Checking access…
      </main>
    );
  }

  if (!authed) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          paddingTop: 120,
          paddingBottom: 80,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            margin: "0 auto",
            padding: 32,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 16,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--blue)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Admin access
          </div>
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
                window.sessionStorage.setItem("hackmarket.admin.token", ADMIN_TOKEN);
                setAuthed(true);
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
              <div
                style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}
              >
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
      </main>
    );
  }

  // ─── Main dashboard ───────────────────────────────────────────────────
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        paddingTop: 92,
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "0 28px",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 28,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--blue)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Approver dashboard
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 32,
                color: "var(--text)",
                margin: "12px 0 6px",
                letterSpacing: "-0.01em",
              }}
            >
              {queue.length} pending review
            </h1>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              Click a submission to inspect its AI Quality Report.
            </p>
          </div>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: focused ? "minmax(320px, 1fr) 1.4fr" : "1fr",
            gap: 18,
          }}
        >
          {/* Queue column */}
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Section title="Awaiting review" badge={`${queue.length}`}>
              {queue.length === 0 ? (
                <EmptyState text="Inbox zero. New submissions land here." />
              ) : (
                queue.map((s) => (
                  <SubmissionCard
                    key={s.id}
                    submission={s}
                    focused={focused?.id === s.id}
                    onClick={() => {
                      setFocusId(s.id);
                      setRejecting(false);
                      setConfirming(null);
                    }}
                  />
                ))
              )}
            </Section>

            {recent.length > 0 && (
              <Section title="Recent actions">
                {recent.slice(0, 5).map((s) => (
                  <SubmissionCard
                    key={s.id}
                    submission={s}
                    focused={focused?.id === s.id}
                    onClick={() => setFocusId(s.id)}
                    compact
                  />
                ))}
              </Section>
            )}
          </section>

          {/* Detail column */}
          {focused && (
            <section
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "26px 28px",
                position: "relative",
              }}
            >
              <DetailHeader submission={focused} />
              <ScorecardRow submission={focused} />
              <ContractBlock submission={focused} />
              <FindingsBlock submission={focused} />

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginTop: 24,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button
                  onClick={() => downloadReport(focused)}
                  style={primaryBtnStyle}
                >
                  📄 Download PDF report
                </button>
                <button
                  onClick={() => {
                    const url = reportBlobUrl(focused);
                    window.open(url, "_blank");
                  }}
                  style={ghostBtnStyle}
                >
                  Preview report ↗
                </button>
                <div style={{ flex: 1 }} />
                {focused.stage === "manual_review" && (
                  <>
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
                      style={approveBtnStyle}
                    >
                      ✓ Approve
                    </button>
                  </>
                )}
                {focused.stage === "listed" && (
                  <span
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      background: "rgba(22,163,74,0.12)",
                      color: "#16a34a",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                  >
                    ✓ LIVE
                  </span>
                )}
                {focused.stage === "rejected" && (
                  <span
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      background: "rgba(220,38,38,0.12)",
                      color: "#dc2626",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                  >
                    ✗ REJECTED
                  </span>
                )}
              </div>

              {/* Approve confirm */}
              {confirming === "approve" && (
                <ConfirmInline
                  text={`Approve ${focused.name}? This will list it on the marketplace and notify the submitter.`}
                  cancelLabel="Cancel"
                  confirmLabel="Yes, approve"
                  confirmColor="#16a34a"
                  onCancel={() => setConfirming(null)}
                  onConfirm={doApprove}
                />
              )}

              {/* Reject reason */}
              {rejecting && (
                <div
                  style={{
                    marginTop: 18,
                    padding: 14,
                    background: "rgba(220,38,38,0.06)",
                    border: "1px solid rgba(220,38,38,0.18)",
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#dc2626",
                      marginBottom: 8,
                    }}
                  >
                    Reject with reason
                  </div>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="What needs to change before resubmission?"
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      fontSize: 13.5,
                      color: "var(--text)",
                      fontFamily: "var(--font-body)",
                      resize: "vertical",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 10,
                      justifyContent: "flex-end",
                    }}
                  >
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
                      style={{
                        ...dangerBtnStyle,
                        opacity: rejectReason.trim() ? 1 : 0.5,
                      }}
                    >
                      Send rejection
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            right: 28,
            background: "var(--card)",
            border: "1px solid var(--border)",
            padding: "12px 18px",
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
            fontSize: 13.5,
            color: "var(--text)",
            zIndex: 100,
            animation: "toastIn 0.25s ease",
          }}
        >
          {toast}
        </div>
      )}

      <style jsx>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}

// ─── Components ──────────────────────────────────────────────────────────

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--muted)",
          }}
        >
          {title}
        </span>
        {badge && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              background: "var(--elevated)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "24px 14px",
        textAlign: "center",
        color: "var(--muted)",
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}

function SubmissionCard({
  submission,
  focused,
  onClick,
  compact,
}: {
  submission: SubmissionRecord;
  focused: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const m = submission.metrics;
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: compact ? "10px 12px" : "14px 14px",
        background: focused ? "rgba(37,99,235,0.06)" : "transparent",
        border: `1px solid ${focused ? "var(--blue)" : "var(--border)"}`,
        borderRadius: 12,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "all 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 10,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: compact ? 13 : 14,
            color: "var(--text)",
          }}
        >
          {submission.name}
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: scoreColor(m.confidence),
            fontWeight: 600,
          }}
        >
          {m.confidence}/100
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11.5,
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>{submission.tech_stack.slice(0, 2).join(" + ") || submission.language}</span>
        <span>⏱ {timeAgo(submission.submitted_at)}</span>
      </div>
      {!compact && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {submission.submitter_email}
        </div>
      )}
      {compact && (
        <div style={{ fontSize: 11, color: scoreColor(m.confidence) }}>
          {submission.stage === "listed"
            ? "✓ Listed"
            : submission.stage === "rejected"
              ? "✗ Rejected"
              : "Awaiting"}
        </div>
      )}
    </button>
  );
}

function DetailHeader({ submission }: { submission: SubmissionRecord }) {
  return (
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
        Submission · {submission.id}
      </div>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          color: "var(--text)",
          margin: "6px 0 6px",
          letterSpacing: "-0.01em",
        }}
      >
        {submission.name}
      </h2>
      <div
        style={{
          color: "var(--muted)",
          fontSize: 13,
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <span>{submission.category}</span>
        <span>·</span>
        <span>{submission.tech_stack.join(" · ") || submission.language}</span>
        <span>·</span>
        <a
          href={submission.github_url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--blue)", textDecoration: "none" }}
        >
          repo ↗
        </a>
      </div>
      <p
        style={{
          color: "var(--text)",
          fontSize: 13.5,
          lineHeight: 1.55,
          marginTop: 12,
        }}
      >
        {submission.description}
      </p>
    </div>
  );
}

function ScorecardRow({ submission }: { submission: SubmissionRecord }) {
  const m = submission.metrics;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 18,
        marginTop: 18,
        padding: "16px 18px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 88,
          height: 88,
          borderRadius: 14,
          background: scoreColor(m.confidence),
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
            fontSize: 30,
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
          / 100 conf
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <MetricChip
          label="Endpoints"
          value={`${m.endpoints_passing}/${m.endpoints_total}`}
          ok={m.endpoints_passing === m.endpoints_total}
        />
        <MetricChip
          label="I/O Match"
          value={`${m.io_match_pct}%`}
          ok={m.io_match_pct >= 90}
        />
        <MetricChip
          label="Avg latency"
          value={`${m.avg_response_ms}ms`}
          ok={m.avg_response_ms < 200}
        />
        <MetricChip
          label="Security"
          value={`${m.security.critical}c · ${m.security.medium}m`}
          ok={m.security.critical === 0 && m.security.medium === 0}
        />
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
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

function ContractBlock({ submission }: { submission: SubmissionRecord }) {
  return (
    <div
      style={{
        marginTop: 18,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}
    >
      <ContractCol label="Inputs" text={submission.inputs} />
      <ContractCol label="Outputs" text={submission.outputs} />
    </div>
  );
}

function ContractCol({ label, text }: { label: string; text: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--text)",
          fontSize: 13,
          marginTop: 6,
          lineHeight: 1.5,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function FindingsBlock({ submission }: { submission: SubmissionRecord }) {
  const m = submission.metrics;
  const items: Array<{ label: string; value: string; mark: "ok" | "warn" | "err" }> = [
    {
      label: "Documentation",
      value: m.docs_quality,
      mark: m.docs_quality === "Good" ? "ok" : m.docs_quality === "Fair" ? "warn" : "err",
    },
    {
      label: "Test coverage",
      value: `${m.test_coverage_pct}%`,
      mark: m.test_coverage_pct >= 60 ? "ok" : m.test_coverage_pct >= 30 ? "warn" : "err",
    },
    {
      label: "Dependencies",
      value: `${m.deps_total} (${m.deps_vulnerable} CVE)`,
      mark: m.deps_vulnerable === 0 ? "ok" : m.deps_vulnerable <= 2 ? "warn" : "err",
    },
    {
      label: "Rate limiting",
      value: m.rate_limiting ? "Implemented" : "Not implemented",
      mark: m.rate_limiting ? "ok" : "warn",
    },
    {
      label: "REST conventions",
      value: m.rest_conventions ? "Followed" : "Non-standard",
      mark: m.rest_conventions ? "ok" : "warn",
    },
  ];

  return (
    <div
      style={{
        marginTop: 18,
        padding: 14,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
          marginBottom: 10,
        }}
      >
        Code quality findings
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        {items.map((f) => (
          <li
            key={f.label}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 13,
            }}
          >
            <span
              style={{
                color:
                  f.mark === "ok" ? "#16a34a" : f.mark === "warn" ? "#d97706" : "#dc2626",
                fontWeight: 700,
                marginTop: 1,
              }}
            >
              {f.mark === "ok" ? "✓" : f.mark === "warn" ? "⚠" : "✗"}
            </span>
            <div>
              <div style={{ color: "var(--text)" }}>{f.label}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{f.value}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfirmInline({
  text,
  cancelLabel,
  confirmLabel,
  confirmColor,
  onCancel,
  onConfirm,
}: {
  text: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmColor: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 18,
        padding: 14,
        background: "rgba(22,163,74,0.06)",
        border: "1px solid rgba(22,163,74,0.2)",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 13.5, color: "var(--text)", marginBottom: 10 }}>{text}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={ghostBtnStyle}>
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          style={{ ...primaryBtnStyle, background: confirmColor }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Button styles ───────────────────────────────────────────────────────

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
};
