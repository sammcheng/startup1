"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONVERTER_URL =
  process.env.NEXT_PUBLIC_CONVERTER_URL ?? "http://localhost:8080";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "input" | "analyzing" | "qa" | "done" | "error";
type ListState = "idle" | "listing" | "submitted";

interface QaResult {
  certified: boolean;
  avg_ms: number | null;
  inputs: Record<string, unknown>;
}

interface Endpoint {
  method: string;
  path: string;
  summary: string;
  request_body?: Record<string, string>;
  response_example?: Record<string, unknown>;
}

interface AnalysisResult {
  slug: string;
  repo_name: string;
  language: string;
  description: string;
  endpoints: Endpoint[];
  setup_notes?: string;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepDots({ step }: { step: Step }) {
  const steps = ["input", "analyzing", "qa", "done"];
  const labels = ["Repo", "Analyzing", "QA Check", "Live"];
  const idx = step === "error" ? 1 : steps.indexOf(step);

  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 36 }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)",
              transition: "all 0.3s",
              background: i < idx ? "var(--green)" : i === idx ? "var(--blue)" : "var(--card)",
              border: `1.5px solid ${i < idx ? "var(--green)" : i === idx ? "var(--blue)" : "var(--border)"}`,
              color: i <= idx ? "#fff" : "var(--faint)",
            }}>
              {i < idx ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 11, color: i === idx ? "var(--text)" : "var(--faint)", whiteSpace: "nowrap" }}>
              {labels[i]}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              width: 52, height: 1.5, marginBottom: 18,
              background: i < idx ? "var(--green)" : "var(--border)",
              transition: "background 0.4s",
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Terminal log ─────────────────────────────────────────────────────────────

function Terminal({ lines, done }: { lines: string[]; done: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  return (
    <div style={{
      background: "#0d0d0d", borderRadius: 12, border: "1px solid #222",
      padding: "16px 20px", fontFamily: "var(--font-mono)", fontSize: 12.5,
      lineHeight: 1.7, minHeight: 140, maxHeight: 220, overflowY: "auto",
    }}>
      <div style={{ color: "#555", marginBottom: 8 }}>$ hackmarket analyze</div>
      {lines.map((line, i) => (
        <div key={i} style={{
          color: line === "Done." ? "#4ade80" : "#d4d4d4",
          display: "flex", gap: 8,
        }}>
          <span style={{ color: "#444" }}>›</span>{line}
        </div>
      ))}
      {!done && (
        <div style={{ display: "flex", gap: 8, color: "#555" }}>
          <span>›</span>
          <span style={{ animation: "blink 1s step-end infinite" }}>█</span>
        </div>
      )}
      <div ref={ref} />
    </div>
  );
}

// ─── QA animation ─────────────────────────────────────────────────────────────

function QaCertAnimation({ done, result }: { done: boolean; result: QaResult | null }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      {!done ? (
        <>
          <div style={{
            width: 64, height: 64, borderRadius: "50%", margin: "0 auto 20px",
            background: "rgba(59,130,246,0.12)", border: "2px solid rgba(59,130,246,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
            animation: "qaSpinPulse 1.5s ease-in-out infinite",
          }}>🔬</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text)", marginBottom: 8 }}>
            Running AI QA Check...
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 340, margin: "0 auto" }}>
            Groq is analyzing your API spec and generating realistic demo inputs. Running 3 benchmark calls.
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 20 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: "50%", background: "var(--blue)",
                animation: `qaDot 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        </>
      ) : result ? (
        <div className="fade-up">
          <div style={{
            width: 64, height: 64, borderRadius: "50%", margin: "0 auto 20px",
            background: result.certified ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
            border: `2px solid ${result.certified ? "var(--green)" : "#f59e0b"}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
          }}>
            {result.certified ? "✓" : "⚠"}
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, color: result.certified ? "var(--green)" : "#f59e0b", marginBottom: 8 }}>
            {result.certified ? "QA Certified!" : "QA Complete"}
          </div>
          {result.avg_ms && (
            <div style={{ color: "var(--muted)", fontSize: 13.5 }}>
              Avg latency: <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{result.avg_ms}ms</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Endpoint card ────────────────────────────────────────────────────────────

function EndpointCard({ ep, base }: { ep: Endpoint; base: string }) {
  const [open, setOpen] = useState(false);
  const method = ep.method.includes("/") ? "POST" : ep.method;
  const color = method === "GET" ? "var(--green)" : "var(--blue)";
  const bg    = method === "GET" ? "rgba(34,197,94,0.12)" : "rgba(59,130,246,0.12)";

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 12,
      overflow: "hidden", transition: "border-color 0.15s",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "14px 16px", display: "flex",
          alignItems: "center", gap: 12, background: "transparent",
          border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5,
          background: bg, color, fontFamily: "var(--font-mono)", flexShrink: 0,
        }}>
          {method}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, color: "var(--text)", fontWeight: 600, flex: 1 }}>
          {base}{ep.path}
        </span>
        <span style={{ color: "var(--faint)", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--border)" }}>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "12px 0 10px" }}>{ep.summary}</p>

          {ep.request_body && Object.keys(ep.request_body).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>REQUEST BODY</div>
              {Object.entries(ep.request_body).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, fontSize: 12.5, marginBottom: 4 }}>
                  <code style={{ color: "var(--blue)", fontFamily: "var(--font-mono)" }}>{k}</code>
                  <span style={{ color: "var(--muted)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {ep.response_example && Object.keys(ep.response_example).length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>RESPONSE</div>
              <pre style={{
                background: "#0d0d0d", borderRadius: 8, padding: "10px 14px",
                fontSize: 12, color: "#d4d4d4", fontFamily: "var(--font-mono)",
                margin: 0, overflowX: "auto",
              }}>
                {JSON.stringify(ep.response_example, null, 2)}
              </pre>
            </div>
          )}

          {/* curl snippet */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>CURL EXAMPLE</div>
            <pre style={{
              background: "#0d0d0d", borderRadius: 8, padding: "10px 14px",
              fontSize: 11.5, color: "#4ade80", fontFamily: "var(--font-mono)",
              margin: 0, overflowX: "auto", whiteSpace: "pre-wrap",
            }}>
              {method === "POST"
                ? `curl -X POST ${base}${ep.path} \\\n  -H "X-Api-Key: hm_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(Object.fromEntries(Object.keys(ep.request_body ?? {}).map(k => [k, "..."])))}' `
                : `curl "${base}${ep.path}" \\\n  -H "X-Api-Key: hm_YOUR_KEY"`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PublishPage() {
  const [step, setStep]       = useState<Step>("input");
  const [repoUrl, setRepoUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [result, setResult]   = useState<AnalysisResult | null>(null);
  const [errMsg, setErrMsg]   = useState("");
  const [listState, setListState] = useState<ListState>("idle");
  const [qaResult, setQaResult] = useState<QaResult | null>(null);
  const [qaDone, setQaDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function validate(url: string) {
    if (!url.trim()) return "Paste a GitHub repository URL.";
    if (!url.startsWith("https://github.com/")) return "Must be a github.com URL.";
    const parts = url.replace("https://github.com/", "").split("/").filter(Boolean);
    if (parts.length < 2) return "URL needs owner and repo name.";
    return "";
  }

  async function handleAnalyze() {
    const err = validate(repoUrl);
    if (err) { setUrlError(err); return; }
    setUrlError("");
    setLogLines([]);
    setResult(null);
    setErrMsg("");
    setStep("analyzing");

    try {
      // Start the job
      const res = await fetch(`${CONVERTER_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl.trim().replace(/\/$/, "") }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `Server error ${res.status}`);
      }

      const { job_id } = await res.json() as { job_id: string };

      // Stream progress
      abortRef.current = new AbortController();
      const stream = await fetch(`${CONVERTER_URL}/api/analyze/${job_id}/stream`, {
        signal: abortRef.current.signal,
      });

      const reader = stream.body!.getReader();
      const dec    = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim()) as {
            type: string; message?: string; result?: AnalysisResult;
          };

          if (payload.type === "log") {
            setLogLines(prev => [...prev, payload.message!]);
          } else if (payload.type === "done") {
            setResult(payload.result!);
            setStep("done");
          } else if (payload.type === "error") {
            throw new Error(payload.message ?? "Analysis failed");
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setErrMsg(e instanceof Error ? e.message : "Unknown error");
      setStep("error");
    }
  }

  async function handleList() {
    if (!result) return;
    setListState("listing");
    try {
      const listRes = await fetch(`${CONVERTER_URL}/api/tools/${result.slug}/list`, { method: "POST" });
      if (!listRes.ok) throw new Error(`Status ${listRes.status}`);

      // Show QA animation step
      setQaDone(false);
      setQaResult(null);
      setStep("qa");

      // Run AI QA check
      try {
        const qaRes = await fetch(`${CONVERTER_URL}/api/tools/${result.slug}/qa`, { method: "POST" });
        if (qaRes.ok) {
          const data = await qaRes.json() as QaResult;
          setQaResult(data);
        }
      } catch {
        // QA failure is non-fatal
      }

      setQaDone(true);
      // Brief pause to show the "certified" state before transitioning
      await new Promise(r => setTimeout(r, 1400));

      setListState("submitted");
      setStep("done");
    } catch {
      setListState("idle");
    }
  }

  function reset() {
    abortRef.current?.abort();
    setStep("input");
    setRepoUrl("");
    setLogLines([]);
    setResult(null);
    setErrMsg("");
    setUrlError("");
    setListState("idle");
    setQaResult(null);
    setQaDone(false);
  }

  const base = result ? `https://api.hackmarket.io/v1/tools/${result.slug}` : "";
  const marketplaceUrl = "/marketplace";

  return (
    <>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
        .fade-up { animation: fadeUp 0.35s ease both; }
        @keyframes qaSpinPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.75} }
        @keyframes qaDot { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
      `}</style>

      <main style={{
        minHeight: "calc(100vh - 56px)", background: "var(--bg)",
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "60px 24px 80px",
      }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48, maxWidth: 560 }} className="fade-up">
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--green)",
            background: "var(--green-dim)", border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: 99, padding: "5px 14px", marginBottom: 20,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
            Publish your project
          </div>
          <h1 style={{
            fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 700,
            fontSize: "clamp(26px, 4vw, 38px)", color: "var(--text)",
            lineHeight: 1.2, marginBottom: 14,
          }}>
            Turn your GitHub repo into<br />a monetizable API.
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.6 }}>
            Paste a link. We analyze the code, detect the endpoints,
            and host everything. You earn on every call.
          </p>
        </div>

        {/* Card */}
        <div style={{
          width: "100%", maxWidth: 700,
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 20, overflow: "hidden",
        }} className="fade-up">
          <div style={{ height: 2, background: "linear-gradient(90deg, var(--blue), var(--green))" }} />
          <div style={{ padding: "36px 40px" }}>
            <StepDots step={step} />

            {/* ── Input ──────────────────────────────────────────────── */}
            {step === "input" && (
              <div className="fade-up">
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
                  Paste your repository URL
                </h2>
                <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 28 }}>
                  Public GitHub repos only.
                </p>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1, position: "relative" }}>
                      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, pointerEvents: "none" }}>🔗</span>
                      <input
                        type="url"
                        placeholder="https://github.com/username/repo"
                        value={repoUrl}
                        onChange={e => { setRepoUrl(e.target.value); setUrlError(""); }}
                        onKeyDown={e => e.key === "Enter" && handleAnalyze()}
                        style={{
                          width: "100%", padding: "12px 14px 12px 42px", borderRadius: 10,
                          border: `1.5px solid ${urlError ? "#ef4444" : "var(--border)"}`,
                          background: "var(--surface, #111)", color: "var(--text)",
                          fontFamily: "var(--font-mono)", fontSize: 13.5, outline: "none",
                          boxSizing: "border-box", transition: "border-color 0.15s",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = "var(--blue)"; }}
                        onBlur={e => { e.currentTarget.style.borderColor = urlError ? "#ef4444" : "var(--border)"; }}
                      />
                    </div>
                    <button
                      onClick={handleAnalyze}
                      style={{
                        padding: "12px 24px", borderRadius: 10, background: "var(--blue)",
                        color: "#fff", fontWeight: 600, fontSize: 14,
                        fontFamily: "var(--font-body)", border: "none", cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Analyze →
                    </button>
                  </div>
                  {urlError && <p style={{ color: "#ef4444", fontSize: 12.5, marginTop: 6, fontFamily: "var(--font-mono)" }}>{urlError}</p>}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>or try an example</span>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {[
                    "https://github.com/tiangolo/fastapi",
                    "https://github.com/pallets/flask",
                    "https://github.com/expressjs/express",
                  ].map(url => (
                    <button key={url} onClick={() => { setRepoUrl(url); setUrlError(""); }}
                      style={{
                        padding: "7px 14px", borderRadius: 8,
                        border: "1px solid var(--border)", background: "transparent",
                        color: "var(--muted)", fontFamily: "var(--font-mono)",
                        fontSize: 12, cursor: "pointer",
                      }}
                    >
                      {url.replace("https://github.com/", "")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Analyzing ──────────────────────────────────────────── */}
            {step === "analyzing" && (
              <div className="fade-up">
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
                  Analyzing repository...
                </h2>
                <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
                  Reading your code and detecting callable endpoints. Takes ~15 seconds.
                </p>
                <Terminal lines={logLines} done={false} />
              </div>
            )}

            {/* ── QA Check ───────────────────────────────────────────── */}
            {step === "qa" && (
              <div className="fade-up">
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
                  AI QA Certification
                </h2>
                <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
                  Generating realistic demo inputs and benchmarking your API.
                </p>
                <QaCertAnimation done={qaDone} result={qaResult} />
              </div>
            )}

            {/* ── Error ──────────────────────────────────────────────── */}
            {step === "error" && (
              <div className="fade-up">
                <div style={{
                  padding: 20, borderRadius: 12,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                  marginBottom: 24,
                }}>
                  <div style={{ fontWeight: 700, color: "#ef4444", marginBottom: 6 }}>Analysis failed</div>
                  <div style={{ color: "var(--muted)", fontSize: 13.5, fontFamily: "var(--font-mono)" }}>{errMsg}</div>
                </div>
                <Terminal lines={logLines} done={true} />
                <button onClick={reset} style={{
                  marginTop: 20, width: "100%", padding: "13px", borderRadius: 12,
                  border: "1.5px solid var(--border)", background: "transparent",
                  color: "var(--text)", fontWeight: 600, fontSize: 14,
                  fontFamily: "var(--font-body)", cursor: "pointer",
                }}>
                  Try again
                </button>
              </div>
            )}

            {/* ── Done ───────────────────────────────────────────────── */}
            {step === "done" && result && (
              <div className="fade-up">
                {/* Success header */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: listState === "submitted" ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.12)",
                    border: listState === "submitted" ? "2px solid #f59e0b" : "2px solid var(--green)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                  }}>{listState === "submitted" ? "📋" : "✓"}</div>
                  <div>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
                      {listState === "submitted" ? `${result.repo_name} is under review` : `${result.repo_name} is ready.`}
                    </h2>
                    <p style={{ color: "var(--muted)", fontSize: 13.5 }}>
                      {listState === "submitted"
                        ? "Typically approved within 24 hours. You'll be notified once it's live."
                        : `${result.language} · ${result.description}`}
                    </p>
                  </div>
                </div>

                {/* Base URL */}
                <div style={{
                  background: "#0d0d0d", borderRadius: 10, border: "1px solid #222",
                  padding: "12px 16px", marginBottom: 20,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                }}>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#4ade80", wordBreak: "break-all" }}>
                    {base}
                  </code>
                  <button
                    onClick={() => navigator.clipboard?.writeText(base)}
                    style={{
                      padding: "5px 12px", borderRadius: 6, border: "1px solid #333",
                      background: "transparent", color: "#888", fontSize: 12,
                      fontFamily: "var(--font-mono)", cursor: "pointer", flexShrink: 0,
                    }}
                  >
                    copy
                  </button>
                </div>

                {/* Endpoints */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, color: "var(--faint)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
                    {result.endpoints.length} ENDPOINT{result.endpoints.length !== 1 ? "S" : ""} DETECTED
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {result.endpoints.map((ep, i) => (
                      <EndpointCard key={i} ep={ep} base={base} />
                    ))}
                  </div>
                </div>

                {result.setup_notes && (
                  <div style={{
                    padding: "12px 16px", borderRadius: 10,
                    background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.25)",
                    marginBottom: 20,
                  }}>
                    <div style={{ fontSize: 11, color: "#f59e0b", fontFamily: "var(--font-mono)", marginBottom: 4 }}>REQUIRED ENV VARS</div>
                    <div style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{result.setup_notes}</div>
                  </div>
                )}

                {listState === "submitted" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }} className="fade-up">
                    <div style={{
                      padding: "16px 18px", borderRadius: 12,
                      background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.3)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: qaResult ? 12 : 0 }}>
                        <span style={{ fontSize: 22 }}>📋</span>
                        <div>
                          <div style={{ fontWeight: 700, color: "#f59e0b", fontSize: 14, marginBottom: 2 }}>
                            {result.repo_name} submitted for review
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            A reviewer will approve your tool before it appears on the marketplace.
                          </div>
                        </div>
                      </div>
                      {qaResult && (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 10, paddingTop: 10,
                          borderTop: "1px solid rgba(245,158,11,0.2)",
                        }}>
                          <span style={{
                            fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700,
                            padding: "3px 10px", borderRadius: 99,
                            background: qaResult.certified ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
                            color: qaResult.certified ? "var(--green)" : "#f59e0b",
                            border: `1px solid ${qaResult.certified ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)"}`,
                          }}>
                            {qaResult.certified ? "✓ QA Certified" : "⚠ QA Partial"}
                          </span>
                          {qaResult.avg_ms && (
                            <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                              {qaResult.avg_ms}ms avg latency
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <Link
                        href={`/tools/${result.slug}`}
                        style={{
                          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                          padding: "13px", borderRadius: 12, background: "var(--blue)",
                          color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none",
                        }}
                      >
                        View submission →
                      </Link>
                      <Link
                        href="/approver"
                        style={{
                          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                          padding: "13px", borderRadius: 12, background: "transparent",
                          border: "1.5px solid var(--border)",
                          color: "var(--muted)", fontWeight: 500, fontSize: 14, textDecoration: "none",
                        }}
                      >
                        Approver dashboard →
                      </Link>
                    </div>
                    <button onClick={reset} style={{
                      padding: "10px", borderRadius: 10, border: "none",
                      background: "transparent", color: "var(--faint)", fontSize: 13,
                      cursor: "pointer",
                    }}>
                      + Publish another repo
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={handleList}
                      disabled={listState === "listing"}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        padding: "13px", borderRadius: 12, background: "var(--green)",
                        color: "#000", fontWeight: 700, fontSize: 14, border: "none",
                        cursor: listState === "listing" ? "not-allowed" : "pointer",
                        opacity: listState === "listing" ? 0.7 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      {listState === "listing" ? (
                        <>
                          <span style={{ display: "inline-block", animation: "blink 0.8s step-end infinite" }}>●</span>
                          Submitting...
                        </>
                      ) : (
                        <>Submit for Review →</>
                      )}
                    </button>
                    <button onClick={reset} style={{
                      padding: "13px 20px", borderRadius: 12,
                      border: "1.5px solid var(--border)", background: "transparent",
                      color: "var(--muted)", fontWeight: 500, fontSize: 14,
                      fontFamily: "var(--font-body)", cursor: "pointer",
                    }}>
                      Publish another
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Trust line */}
        {step === "input" && (
          <div style={{ marginTop: 24, display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }} className="fade-up">
            {["No infrastructure to manage", "AI-powered endpoint detection", "Earn on every API call"].map(t => (
              <span key={t} style={{ fontSize: 13, color: "var(--faint)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--green)" }}>✓</span> {t}
              </span>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
