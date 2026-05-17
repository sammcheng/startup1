"use client";

import { useEffect, useState } from "react";

const CONVERTER_URL =
  process.env.NEXT_PUBLIC_CONVERTER_URL ?? "http://localhost:8080";

interface Endpoint {
  method: string;
  path: string;
  summary: string;
  request_body?: Record<string, string>;
}

interface PendingTool {
  id: string;
  slug: string;
  repo_url: string;
  name: string;
  language: string;
  description: string;
  endpoints: Endpoint[];
  qa_certified: boolean;
  qa_avg_ms: number | null;
  pdf_summary: string | null;
  created_at: string;
}

type ActionState = "idle" | "approving" | "rejecting";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  let inList = false;
  let listItems: string[] = [];

  function flushTable() {
    if (tableRows.length) {
      out.push(`<table style="border-collapse:collapse;width:100%;margin:8px 0">${tableRows.join("")}</table>`);
      tableRows = [];
    }
    inTable = false;
  }
  function flushList() {
    if (listItems.length) {
      out.push(`<ul style="padding-left:18px;margin:6px 0">${listItems.join("")}</ul>`);
      listItems = [];
    }
    inList = false;
  }

  for (const raw of lines) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e5e5e5">$1</strong>')
      .replace(/`(.+?)`/g, '<code style="background:#1a1a1a;padding:1px 5px;border-radius:3px;font-family:monospace;font-size:12px;color:#4ade80">$1</code>');

    if (/^\| .+ \|$/.test(line)) {
      if (inList) flushList();
      inTable = true;
      const cells = line.split("|").filter(Boolean).map(c =>
        `<td style="padding:4px 10px;border:1px solid #333;font-size:12px">${c.trim()}</td>`
      ).join("");
      tableRows.push(`<tr>${cells}</tr>`);
      continue;
    }
    if (inTable) flushTable();

    if (/^- .+/.test(line)) {
      if (inTable) flushTable();
      inList = true;
      listItems.push(`<li style="margin:2px 0;font-size:13px">${line.slice(2)}</li>`);
      continue;
    }
    if (inList) flushList();

    if (/^# /.test(line)) {
      out.push(`<h1 style="font-size:18px;font-weight:700;margin:0 0 12px">${line.slice(2)}</h1>`);
    } else if (/^## /.test(line)) {
      out.push(`<h2 style="font-size:14px;font-weight:700;margin:16px 0 8px;color:#d4d4d4">${line.slice(3)}</h2>`);
    } else if (line === "---") {
      out.push('<hr style="border:none;border-top:1px solid #333;margin:14px 0"/>');
    } else if (line === "") {
      out.push("<br/>");
    } else {
      out.push(`<p style="margin:4px 0;font-size:13px">${line}</p>`);
    }
  }
  if (inTable) flushTable();
  if (inList) flushList();
  return out.join("");
}

export default function ApproverPage() {
  const [tools, setTools] = useState<PendingTool[]>([]);
  const [selected, setSelected] = useState<PendingTool | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ActionState>("idle");
  const [rejectNotes, setRejectNotes] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showRejectBox, setShowRejectBox] = useState(false);

  useEffect(() => {
    void fetchPending();
  }, []);

  async function fetchPending() {
    setLoading(true);
    try {
      const res = await fetch(`${CONVERTER_URL}/api/tools/pending`);
      const data = await res.json() as { tools: PendingTool[] };
      setTools(data.tools);
      if (data.tools.length > 0 && !selected) setSelected(data.tools[0]);
    } catch {
      // converter offline
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleApprove() {
    if (!selected) return;
    setAction("approving");
    try {
      await fetch(`${CONVERTER_URL}/api/tools/${selected.slug}/approve`, { method: "POST" });
      setTools(prev => prev.filter(t => t.slug !== selected.slug));
      const next = tools.find(t => t.slug !== selected.slug) ?? null;
      setSelected(next);
      showToast(`✓ ${selected.name} approved and live`, true);
    } catch {
      showToast("Approve failed", false);
    } finally {
      setAction("idle");
    }
  }

  async function handleReject() {
    if (!selected) return;
    setAction("rejecting");
    try {
      await fetch(`${CONVERTER_URL}/api/tools/${selected.slug}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: rejectNotes }),
      });
      setTools(prev => prev.filter(t => t.slug !== selected.slug));
      const next = tools.find(t => t.slug !== selected.slug) ?? null;
      setSelected(next);
      setRejectNotes("");
      setShowRejectBox(false);
      showToast(`✗ ${selected.name} rejected`, false);
    } catch {
      showToast("Reject failed", false);
    } finally {
      setAction("idle");
    }
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-area {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: white; color: black; padding: 40px; font-family: Georgia, serif;
            font-size: 13px; line-height: 1.6;
          }
          .print-area h1 { font-size: 22px; margin-bottom: 6px; }
          .print-area h2 { font-size: 15px; margin-top: 18px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
          .print-area table { width: 100%; border-collapse: collapse; margin: 8px 0; }
          .print-area td, .print-area th { border: 1px solid #ccc; padding: 4px 8px; font-size: 12px; }
          .print-area hr { border-top: 1px solid #ddd; margin: 14px 0; }
          .print-area code { background: #f5f5f5; padding: 1px 4px; border-radius: 2px; font-size: 11px; }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 13,
          background: toast.ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          border: `1px solid ${toast.ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
          color: toast.ok ? "var(--green)" : "#ef4444",
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ minHeight: "calc(100vh - 56px)", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div className="no-print" style={{
          borderBottom: "1px solid var(--border)", padding: "20px 32px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
              Internal Tool
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              Approver Dashboard
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              padding: "6px 14px", borderRadius: 99, fontSize: 12, fontFamily: "var(--font-mono)",
              background: tools.length > 0 ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.1)",
              color: tools.length > 0 ? "#f59e0b" : "var(--green)",
              border: `1px solid ${tools.length > 0 ? "rgba(245,158,11,0.3)" : "rgba(34,197,94,0.25)"}`,
            }}>
              {tools.length} pending
            </div>
            <button
              onClick={() => void fetchPending()}
              style={{
                padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)",
                background: "transparent", color: "var(--muted)", fontSize: 12,
                fontFamily: "var(--font-mono)", cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="no-print" style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Left: queue */}
          <div style={{
            width: 280, borderRight: "1px solid var(--border)",
            overflowY: "auto", flexShrink: 0,
          }}>
            {loading ? (
              <div style={{ padding: 24, color: "var(--faint)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
                Loading...
              </div>
            ) : tools.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>Queue is empty</div>
              </div>
            ) : (
              tools.map(tool => (
                <button
                  key={tool.slug}
                  onClick={() => { setSelected(tool); setShowRejectBox(false); }}
                  style={{
                    width: "100%", padding: "14px 16px", textAlign: "left",
                    background: selected?.slug === tool.slug ? "var(--card)" : "transparent",
                    border: "none", borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    borderLeft: selected?.slug === tool.slug ? "3px solid var(--blue)" : "3px solid transparent",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)", marginBottom: 4 }}>
                    {tool.name}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 6px", borderRadius: 4,
                      background: "var(--elevated)", color: "var(--muted)",
                    }}>
                      {tool.language}
                    </span>
                    {tool.qa_certified && (
                      <span style={{ fontSize: 10, color: "var(--green)", fontFamily: "var(--font-mono)" }}>✓ QA</span>
                    )}
                    <span style={{ fontSize: 10, color: "var(--faint)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>
                      {timeAgo(tool.created_at)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Right: detail */}
          {selected ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
              {/* Tool header */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                      {selected.name}
                    </h2>
                    <p style={{ color: "var(--muted)", fontSize: 14, maxWidth: 560, margin: 0 }}>
                      {selected.description}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {selected.qa_certified && (
                      <span style={{
                        fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 700,
                        padding: "4px 12px", borderRadius: 99,
                        background: "rgba(34,197,94,0.1)", color: "var(--green)",
                        border: "1px solid rgba(34,197,94,0.25)",
                      }}>
                        ✓ QA Certified{selected.qa_avg_ms ? ` · ${selected.qa_avg_ms}ms` : ""}
                      </span>
                    )}
                    <a
                      href={selected.repo_url} target="_blank" rel="noopener noreferrer"
                      style={{
                        fontSize: 12, fontFamily: "var(--font-mono)", padding: "4px 12px",
                        borderRadius: 99, border: "1px solid var(--border)",
                        color: "var(--muted)", textDecoration: "none",
                      }}
                    >
                      GitHub ↗
                    </a>
                  </div>
                </div>

                {/* Endpoints */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--font-mono)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {selected.endpoints.length} Endpoints
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selected.endpoints.map((ep, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                        borderRadius: 8, background: "var(--card)", border: "1px solid var(--border)",
                      }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                          background: ep.method === "GET" ? "rgba(34,197,94,0.12)" : "rgba(59,130,246,0.12)",
                          color: ep.method === "GET" ? "var(--green)" : "var(--blue)",
                          fontFamily: "var(--font-mono)",
                        }}>
                          {ep.method}
                        </span>
                        <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text)" }}>
                          {ep.path}
                        </code>
                        <span style={{ color: "var(--faint)", fontSize: 12 }}>{ep.summary}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* PDF Summary */}
              {selected.pdf_summary && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      AI-Generated Review Summary
                    </div>
                    <button
                      onClick={() => window.print()}
                      style={{
                        fontSize: 12, fontFamily: "var(--font-mono)", padding: "4px 12px",
                        borderRadius: 6, border: "1px solid var(--border)",
                        background: "transparent", color: "var(--muted)", cursor: "pointer",
                      }}
                    >
                      Print / Save as PDF ↗
                    </button>
                  </div>
                  <div
                    className="print-area"
                    style={{
                      background: "var(--card)", border: "1px solid var(--border)",
                      borderRadius: 12, padding: "20px 24px",
                      color: "var(--text)", fontSize: 13, lineHeight: 1.7,
                    }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.pdf_summary) }}
                  />
                </div>
              )}

              {/* Action buttons */}
              <div style={{
                padding: "20px 24px", borderRadius: 12,
                background: "var(--card)", border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: 12, color: "var(--faint)", fontFamily: "var(--font-mono)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Decision
                </div>

                {!showRejectBox ? (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => void handleApprove()}
                      disabled={action !== "idle"}
                      style={{
                        flex: 1, padding: "13px", borderRadius: 10, border: "none",
                        background: "var(--green)", color: "#000", fontWeight: 700, fontSize: 14,
                        cursor: action !== "idle" ? "not-allowed" : "pointer",
                        opacity: action === "approving" ? 0.7 : 1,
                      }}
                    >
                      {action === "approving" ? "Approving..." : "✓ Approve & Go Live"}
                    </button>
                    <button
                      onClick={() => setShowRejectBox(true)}
                      disabled={action !== "idle"}
                      style={{
                        flex: 1, padding: "13px", borderRadius: 10,
                        border: "1.5px solid rgba(239,68,68,0.4)",
                        background: "rgba(239,68,68,0.07)", color: "#ef4444",
                        fontWeight: 700, fontSize: 14,
                        cursor: action !== "idle" ? "not-allowed" : "pointer",
                      }}
                    >
                      ✗ Reject
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <textarea
                      placeholder="Reason for rejection (optional)..."
                      value={rejectNotes}
                      onChange={e => setRejectNotes(e.target.value)}
                      rows={3}
                      style={{
                        width: "100%", padding: "10px 14px", borderRadius: 8,
                        border: "1.5px solid rgba(239,68,68,0.3)",
                        background: "var(--surface, #111)", color: "var(--text)",
                        fontFamily: "var(--font-mono)", fontSize: 13, resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => void handleReject()}
                        disabled={action !== "idle"}
                        style={{
                          flex: 1, padding: "11px", borderRadius: 8, border: "none",
                          background: "#ef4444", color: "#fff", fontWeight: 700, fontSize: 13,
                          cursor: action !== "idle" ? "not-allowed" : "pointer",
                          opacity: action === "rejecting" ? 0.7 : 1,
                        }}
                      >
                        {action === "rejecting" ? "Rejecting..." : "Confirm Reject"}
                      </button>
                      <button
                        onClick={() => { setShowRejectBox(false); setRejectNotes(""); }}
                        style={{
                          padding: "11px 18px", borderRadius: 8,
                          border: "1px solid var(--border)", background: "transparent",
                          color: "var(--muted)", fontSize: 13, cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", color: "var(--faint)" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 14 }}>Select a submission to review</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
