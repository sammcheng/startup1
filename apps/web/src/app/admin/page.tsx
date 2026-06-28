"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Activity, AlertTriangle, RefreshCcw, ShieldCheck, UserX } from "lucide-react";

import { useCurrentAccount } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { syncCurrentUser } from "@/lib/auth-sync";

type UserRole = "seller" | "buyer" | "both" | "admin";
type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed";

interface AdminUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string | null;
}

interface AdminUserListResponse {
  items: AdminUser[];
  total: number;
}

interface AdminProcessingJob {
  id: string;
  tool_id: string;
  seller_id: string;
  status: JobStatus;
  trigger: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  tool_name: string | null;
  tool_slug: string | null;
  tool_status: string | null;
  seller_email: string | null;
}

interface AdminProcessingJobListResponse {
  items: AdminProcessingJob[];
  total: number;
}

interface AdminAuditLog {
  id: string;
  admin_id: string;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AdminAuditLogListResponse {
  items: AdminAuditLog[];
  total: number;
}

interface AdminOperationsHealth {
  status: "healthy" | "degraded";
  checks: Record<string, string>;
  queue: {
    name: string;
    depth: number | null;
    depth_threshold: number;
    worker_heartbeat: boolean;
    worker_health_check_key: string;
  };
  processing_jobs: {
    stuck_active: number;
    failed_recent: number;
    stale_after_seconds: number;
    failed_threshold: number;
    failed_window_seconds: number;
  };
}

type AccessState = "checking" | "ready" | "signed_out" | "forbidden" | "not_configured" | "error";

export default function AdminPage() {
  const account = useCurrentAccount();
  const [access, setAccess] = useState<AccessState>("checking");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!account.isLoaded) {
      setAccess("checking");
      return;
    }
    if (!account.isAuthConfigured) {
      setToken(null);
      setAccess("not_configured");
      return;
    }
    if (!account.isSignedIn || !account.user) {
      setToken(null);
      setAccess("signed_out");
      return;
    }

    let active = true;
    async function verifyAdmin() {
      setAccess("checking");
      setMessage(null);
      try {
        const sessionToken = await account.getToken();
        if (!sessionToken) throw new Error("Missing session token.");
        const synced = await syncCurrentUser(account.user!, sessionToken);
        if (synced?.role !== "admin") {
          if (!active) return;
          setToken(null);
          setAccess("forbidden");
          return;
        }
        if (!active) return;
        setToken(sessionToken);
        setAccess("ready");
      } catch (error) {
        if (!active) return;
        setToken(null);
        setMessage(error instanceof Error ? error.message : "Could not verify admin access.");
        setAccess("error");
      }
    }

    void verifyAdmin();
    return () => {
      active = false;
    };
  }, [account]);

  if (access !== "ready" || !token) {
    return <AccessGate access={access} message={message} />;
  }

  return <AdminOperations token={token} />;
}

function AdminOperations({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [jobs, setJobs] = useState<AdminProcessingJob[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [health, setHealth] = useState<AdminOperationsHealth | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setNotice(null);
    try {
      const [healthResponse, userResponse, jobResponse, auditResponse] = await Promise.all([
        api.get<AdminOperationsHealth>("/admin/operations-health", { token }),
        api.get<AdminUserListResponse>("/admin/users?limit=25", { token }),
        api.get<AdminProcessingJobListResponse>("/admin/processing-jobs?limit=25", { token }),
        api.get<AdminAuditLogListResponse>("/admin/audit-logs?limit=25", { token }),
      ]);
      setHealth(healthResponse);
      setUsers(userResponse.items);
      setJobs(jobResponse.items);
      setAuditLogs(auditResponse.items);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setNotice(error instanceof ApiError ? error.message : "Could not load admin operations data.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateUser(user: AdminUser, isActive: boolean) {
    setNotice(null);
    try {
      const updated = await api.patch<AdminUser>(
        `/admin/users/${user.id}`,
        { is_active: isActive },
        { token },
      );
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`${updated.email} is now ${updated.is_active ? "active" : "suspended"}.`);
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not update this user.");
    }
  }

  async function retryJob(job: AdminProcessingJob) {
    setNotice(null);
    try {
      const retried = await api.post<AdminProcessingJob>(
        `/admin/processing-jobs/${job.id}/retry`,
        { reason: "Retried from admin operations dashboard" },
        { token },
      );
      setJobs((current) => [retried, ...current.filter((item) => item.id !== retried.id)]);
      setNotice(`Queued retry for ${retried.tool_name ?? retried.tool_id}.`);
      void load();
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not retry this job.");
    }
  }

  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const suspendedUsers = users.filter((user) => !user.is_active).length;

  return (
    <main style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <p style={eyebrowStyle}>Production operations</p>
          <h1 style={titleStyle}>Admin control room</h1>
          <p style={subtitleStyle}>
            Moderate accounts, inspect worker jobs, and retry failed submissions without touching the database.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Metric label="Failed jobs" value={failedJobs} tone={failedJobs ? "danger" : "ok"} />
          <Metric label="Suspended users" value={suspendedUsers} tone={suspendedUsers ? "warn" : "ok"} />
          <Link href="/approver" style={primaryButtonStyle}>Open approver queue</Link>
        </div>
      </section>

      {notice ? <div style={noticeStyle}>{notice}</div> : null}
      {status === "error" ? <div style={errorStyle}>{notice ?? "Admin data failed to load."}</div> : null}

      <OperationsHealthPanel health={health} status={status} onRefresh={load} />

      <section style={gridStyle}>
        <Panel
          title="Processing jobs"
          action={<button type="button" onClick={() => void load()} style={ghostButtonStyle}><RefreshCcw size={15} /> Refresh</button>}
        >
          {status === "loading" ? <EmptyState text="Loading jobs…" /> : null}
          {status !== "loading" && jobs.length === 0 ? <EmptyState text="No processing jobs yet." /> : null}
          {jobs.map((job) => (
            <article key={job.id} style={rowStyle}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{job.tool_name ?? "Unknown tool"}</strong>
                  <StatusPill status={job.status} />
                </div>
                <p style={mutedStyle}>
                  {job.seller_email ?? "Unknown seller"} · attempts {job.attempts}/{job.max_attempts} · {job.trigger}
                </p>
                {job.last_error ? <p style={errorTextStyle}>{job.last_error}</p> : null}
              </div>
              {job.status === "failed" ? (
                <button type="button" onClick={() => void retryJob(job)} style={dangerButtonStyle}>
                  Retry
                </button>
              ) : null}
            </article>
          ))}
        </Panel>

        <Panel title="Audit trail">
          {status === "loading" ? <EmptyState text="Loading audit logs…" /> : null}
          {status !== "loading" && auditLogs.length === 0 ? <EmptyState text="No admin actions recorded yet." /> : null}
          {auditLogs.map((log) => (
            <article key={log.id} style={rowStyle}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{humanizeAction(log.action)}</strong>
                  <span style={rolePillStyle}>{log.target_type}</span>
                </div>
                <p style={mutedStyle}>
                  {log.admin_email ?? "Unknown admin"} · {new Date(log.created_at).toLocaleString()}
                </p>
                {log.details ? <p style={mutedStyle}>{summarizeAuditDetails(log.details)}</p> : null}
              </div>
            </article>
          ))}
        </Panel>

        <Panel title="Users">
          {status === "loading" ? <EmptyState text="Loading users…" /> : null}
          {status !== "loading" && users.length === 0 ? <EmptyState text="No users found." /> : null}
          {users.map((user) => (
            <article key={user.id} style={rowStyle}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{user.display_name || user.username}</strong>
                  <span style={rolePillStyle}>{user.role}</span>
                  <span style={user.is_active ? activePillStyle : suspendedPillStyle}>
                    {user.is_active ? "active" : "suspended"}
                  </span>
                </div>
                <p style={mutedStyle}>{user.email}</p>
              </div>
              {user.role !== "admin" ? (
                <button
                  type="button"
                  onClick={() => void updateUser(user, !user.is_active)}
                  style={user.is_active ? ghostDangerButtonStyle : ghostButtonStyle}
                >
                  {user.is_active ? <UserX size={15} /> : <ShieldCheck size={15} />}
                  {user.is_active ? "Suspend" : "Reactivate"}
                </button>
              ) : null}
            </article>
          ))}
        </Panel>
      </section>
    </main>
  );
}

function humanizeAction(action: string) {
  return action.replaceAll("_", " ");
}

function summarizeAuditDetails(details: Record<string, unknown>) {
  const pairs = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return pairs.join(" · ");
}

function OperationsHealthPanel({
  health,
  status,
  onRefresh,
}: {
  health: AdminOperationsHealth | null;
  status: "loading" | "ready" | "error";
  onRefresh: () => Promise<void>;
}) {
  const degraded = health?.status === "degraded";
  return (
    <section style={healthPanelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <p style={eyebrowStyle}>Live operations</p>
          <h2 style={panelTitleStyle}>Production health</h2>
        </div>
        <button type="button" onClick={() => void onRefresh()} style={ghostButtonStyle}>
          <RefreshCcw size={15} />
          Refresh
        </button>
      </div>
      {status === "loading" ? <EmptyState text="Loading operations health…" /> : null}
      {status !== "loading" && !health ? <EmptyState text="Health summary is unavailable." /> : null}
      {health ? (
        <>
          <div style={healthBannerStyle(degraded)}>
            <Activity size={18} />
            <strong>{degraded ? "Needs attention" : "Healthy"}</strong>
            <span>
              Queue {health.checks.queue}, worker {health.checks.worker}, processing jobs{" "}
              {health.checks.processing_jobs}.
            </span>
          </div>
          <div style={healthGridStyle}>
            <HealthCard
              label="Queue depth"
              value={health.queue.depth === null ? "unknown" : `${health.queue.depth}/${health.queue.depth_threshold}`}
              tone={health.checks.queue === "ok" ? "ok" : "danger"}
            />
            <HealthCard
              label="Worker heartbeat"
              value={health.queue.worker_heartbeat ? "online" : "missing"}
              tone={health.checks.worker === "ok" ? "ok" : "danger"}
            />
            <HealthCard
              label="Stuck jobs"
              value={`${health.processing_jobs.stuck_active}`}
              tone={health.processing_jobs.stuck_active ? "danger" : "ok"}
            />
            <HealthCard
              label="Recent failures"
              value={`${health.processing_jobs.failed_recent}/${health.processing_jobs.failed_threshold}`}
              tone={health.processing_jobs.failed_recent >= health.processing_jobs.failed_threshold ? "danger" : "ok"}
            />
          </div>
          <p style={mutedStyle}>
            Stuck threshold: {Math.round(health.processing_jobs.stale_after_seconds / 60)} minutes. Failure window:{" "}
            {Math.round(health.processing_jobs.failed_window_seconds / 60)} minutes.
          </p>
        </>
      ) : null}
    </section>
  );
}

function AccessGate({ access, message }: { access: AccessState; message: string | null }) {
  const copy: Record<AccessState, { title: string; body: string }> = {
    checking: { title: "Checking admin access", body: "Verifying your signed-in account." },
    ready: { title: "Ready", body: "" },
    signed_out: { title: "Sign in required", body: "Admin operations are only available to signed-in admins." },
    forbidden: { title: "Admin role required", body: "Your account is signed in, but it is not marked as an admin." },
    not_configured: { title: "Auth not configured", body: "Clerk production keys are required before admin operations can run." },
    error: { title: "Could not verify access", body: message ?? "Try signing in again." },
  };
  const content = copy[access];
  return (
    <main style={pageStyle}>
      <section style={{ ...heroStyle, minHeight: 360, alignItems: "center" }}>
        <div>
          <p style={eyebrowStyle}>Admin</p>
          <h1 style={titleStyle}>{content.title}</h1>
          <p style={subtitleStyle}>{content.body}</p>
          {access === "signed_out" ? <Link href="/sign-in" style={primaryButtonStyle}>Sign in</Link> : null}
        </div>
      </section>
    </main>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={panelStyle}>
      <header style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{title}</h2>
        {action}
      </header>
      <div style={{ display: "grid", gap: 12 }}>{children}</div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "danger" }) {
  const color = tone === "danger" ? "#dc2626" : tone === "warn" ? "#d97706" : "#16a34a";
  return (
    <div style={metricStyle}>
      <span style={{ ...mutedStyle, fontSize: 12 }}>{label}</span>
      <strong style={{ color, fontSize: 28 }}>{value}</strong>
    </div>
  );
}

function HealthCard({ label, value, tone }: { label: string; value: string; tone: "ok" | "danger" }) {
  const color = tone === "danger" ? "#dc2626" : "#16a34a";
  return (
    <div style={metricStyle}>
      <span style={{ ...mutedStyle, fontSize: 12 }}>{label}</span>
      <strong style={{ color, fontSize: 22 }}>{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const style =
    status === "failed"
      ? suspendedPillStyle
      : status === "succeeded"
        ? activePillStyle
        : rolePillStyle;
  return <span style={style}>{status}</span>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={emptyStyle}>
      <AlertTriangle size={16} />
      {text}
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "120px min(5vw, 72px) 56px",
  background:
    "radial-gradient(circle at 12% 8%, rgba(37,99,235,.15), transparent 32%), linear-gradient(135deg, #f8fafc 0%, #eef2ff 48%, #fff7ed 100%)",
  color: "var(--text)",
};

const heroStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 28,
  flexWrap: "wrap",
  padding: 28,
  borderRadius: 28,
  border: "1px solid rgba(15,23,42,.1)",
  background: "rgba(255,255,255,.76)",
  boxShadow: "0 24px 80px rgba(15,23,42,.12)",
  backdropFilter: "blur(18px)",
};

const eyebrowStyle: CSSProperties = {
  margin: "0 0 10px",
  color: "var(--blue)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: ".12em",
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-display)",
  fontSize: "clamp(36px, 6vw, 72px)",
  lineHeight: .92,
  letterSpacing: "-.06em",
};

const subtitleStyle: CSSProperties = {
  maxWidth: 720,
  color: "var(--muted)",
  fontSize: 17,
  lineHeight: 1.7,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
  gap: 20,
  marginTop: 20,
};

const healthPanelStyle: CSSProperties = {
  padding: 20,
  borderRadius: 24,
  border: "1px solid rgba(15,23,42,.1)",
  background: "rgba(255,255,255,.82)",
  boxShadow: "0 18px 50px rgba(15,23,42,.09)",
  marginTop: 20,
};

const healthGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
};

function healthBannerStyle(degraded: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    border: degraded ? "1px solid rgba(220,38,38,.22)" : "1px solid rgba(22,163,74,.2)",
    background: degraded ? "rgba(254,242,242,.92)" : "rgba(240,253,244,.9)",
    color: degraded ? "#b91c1c" : "#15803d",
  };
}

const panelStyle: CSSProperties = {
  padding: 20,
  borderRadius: 24,
  border: "1px solid rgba(15,23,42,.1)",
  background: "rgba(255,255,255,.82)",
  boxShadow: "0 18px 50px rgba(15,23,42,.09)",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 16,
};

const panelTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-display)",
  fontSize: 24,
  letterSpacing: "-.03em",
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  padding: 16,
  borderRadius: 18,
  border: "1px solid rgba(15,23,42,.08)",
  background: "rgba(248,250,252,.86)",
};

const metricStyle: CSSProperties = {
  minWidth: 132,
  padding: 16,
  borderRadius: 18,
  border: "1px solid rgba(15,23,42,.09)",
  background: "#fff",
};

const mutedStyle: CSSProperties = {
  margin: "6px 0 0",
  color: "var(--muted)",
  fontSize: 13,
};

const errorTextStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "#b91c1c",
  fontSize: 13,
  lineHeight: 1.5,
};

const noticeStyle: CSSProperties = {
  marginTop: 16,
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(37,99,235,.18)",
  background: "rgba(239,246,255,.92)",
  color: "#1d4ed8",
};

const errorStyle: CSSProperties = {
  marginTop: 16,
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(220,38,38,.2)",
  background: "rgba(254,242,242,.92)",
  color: "#b91c1c",
};

const emptyStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: 16,
  color: "var(--muted)",
  borderRadius: 18,
  border: "1px dashed rgba(15,23,42,.16)",
};

const pillBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 700,
};

const rolePillStyle: CSSProperties = {
  ...pillBase,
  color: "#1d4ed8",
  background: "#dbeafe",
};

const activePillStyle: CSSProperties = {
  ...pillBase,
  color: "#15803d",
  background: "#dcfce7",
};

const suspendedPillStyle: CSSProperties = {
  ...pillBase,
  color: "#b91c1c",
  background: "#fee2e2",
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 42,
  padding: "0 16px",
  borderRadius: 14,
  border: "1px solid var(--blue)",
  background: "var(--blue)",
  color: "#fff",
  fontWeight: 800,
};

const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 38,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,.12)",
  background: "#fff",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostDangerButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  color: "#b91c1c",
  border: "1px solid rgba(220,38,38,.2)",
};

const dangerButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  color: "#fff",
  border: "1px solid #dc2626",
  background: "#dc2626",
};
