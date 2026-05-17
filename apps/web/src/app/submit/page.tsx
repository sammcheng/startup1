"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { CATEGORIES } from "@hackmarket/shared";
import {
  newSubmissionFromAnalysis,
  upsertSubmission,
  type SubmissionRecord,
} from "@/lib/submissions";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUBMIT_STEPS = [
  "Cloning repository...",
  "Reading project structure...",
  "Analyzing dependencies and stack...",
  "Identifying inputs and outputs...",
  "Generating module listing...",
] as const;

// kc's hard-coded fallback so the demo never dead-ends if /tools/submit
// errors (network, OPENROUTER_API_KEY unset, etc.).
const AUTO_LISTING: Listing = {
  id: null,
  name: "CacheLayer",
  description:
    "In-memory caching middleware with TTL management and automatic cache invalidation hooks. Drop in as an Express middleware or call directly from your service layer — supports Redis or in-process backends with the same API.",
  category: "DevOps",
  stack: ["Node.js", "Redis", "TypeScript"],
  inputs: "Cache key, value (any serializable), TTL in seconds, optional invalidation tags.",
  outputs: "Hit/miss status, cached value on hit, eviction events on TTL or tag invalidation.",
  language: "TypeScript",
  license: "MIT",
};

const EXAMPLE_REPOS = [
  "https://github.com/tiangolo/fastapi",
  "https://github.com/pallets/flask",
  "https://github.com/expressjs/express",
];

// Page wrapper — natural height (was a constrained "min(900px, calc(100vh - 56px))"
// with overflow:hidden, but that combination can collapse to ~0 in some
// browsers/viewports, leaving the page blank. Let the content flow.
const PAGE_MIN_HEIGHT = "calc(100vh - 56px)";

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = "input" | "analyzing" | "review" | "done";
type PricingModel = "buy" | "royalty";

interface Listing {
  id: string | null;
  name: string;
  description: string;
  category: string;
  stack: string[];
  inputs: string;
  outputs: string;
  language: string;
  license: string;
}

// Shape of /tools/submit response — kept loose so the kc-shape `analysis`
// fields can be consumed without dragging in every nested ToolResponse field.
interface SubmitResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: { id: string; [key: string]: any };
  analysis: {
    name: string;
    description: string;
    category: string;
    tech_stack: string[];
    input_contract: string;
    output_contract: string;
    complexity: string;
    suggested_price_cents: number;
    pricing_model: PricingModel;
    // Optional — server may or may not surface these.
    language?: string;
    license?: string;
  };
  message: string;
}

// ─── URL validation (lifted from /publish) ───────────────────────────────────

function validateGithubUrl(url: string): string {
  if (!url.trim()) return "Paste a GitHub repository URL.";
  if (!url.startsWith("https://github.com/")) return "Must be a github.com URL.";
  const parts = url.replace("https://github.com/", "").split("/").filter(Boolean);
  if (parts.length < 2) return "URL needs owner and repo name.";
  return "";
}

// Guess primary language from tech stack if API didn't return one explicitly.
function inferLanguage(stack: string[]): string {
  const LANGS = ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Ruby", "Java", "C++", "C#"];
  for (const s of stack) {
    const hit = LANGS.find((l) => l.toLowerCase() === s.toLowerCase());
    if (hit) return hit;
  }
  if (stack.some((s) => /node|express|next|react/i.test(s))) return "TypeScript";
  if (stack.some((s) => /flask|fastapi|django/i.test(s))) return "Python";
  return stack[0] || "Unknown";
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SubmitPage() {
  // Phase + input state
  const [phase, setPhase] = useState<Phase>("input");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");

  // Analyzing animation
  const [step, setStep] = useState(-1);

  // Review state
  const [listing, setListing] = useState<Listing | null>(null);
  const [stackInput, setStackInput] = useState("");
  const [pricingModel, setPricingModel] = useState<PricingModel>("buy");
  const [amount, setAmount] = useState("");

  // API state (runs in parallel with the animation; transition is gated on both)
  const [apiResponse, setApiResponse] = useState<SubmitResponse | null>(null);
  const [apiReady, setApiReady] = useState(false);

  // Persisted submission record (kept across phase changes for status tracking)
  const [submissionRecord, setSubmissionRecord] = useState<SubmissionRecord | null>(null);

  // ── Kick off analysis ───────────────────────────────────────────────────────
  function analyze() {
    const err = validateGithubUrl(url);
    if (err) {
      setUrlError(err);
      return;
    }
    setUrlError("");
    setApiResponse(null);
    setApiReady(false);
    setPhase("analyzing");
    setStep(0);

    api
      .post<SubmitResponse>(
        "/tools/submit",
        { github_url: url.trim(), submitter_email: "demo@hackmarket.io" },
        { timeoutMs: 60_000 }
      )
      .then((res) => {
        setApiResponse(res);
      })
      .catch(() => {
        // Swallow — the transition effect falls back to AUTO_LISTING.
      })
      .finally(() => setApiReady(true));
  }

  // ── Step animation (advance, hold on last step until API resolves) ──────────
  useEffect(() => {
    if (phase !== "analyzing") return;
    if (step >= SUBMIT_STEPS.length - 1) return;
    const t = setTimeout(() => setStep((s) => s + 1), 600);
    return () => clearTimeout(t);
  }, [phase, step]);

  // ── Gate the transition to `review` on both animation done + API settled ────
  useEffect(() => {
    if (phase !== "analyzing") return;
    if (!apiReady) return;
    if (step < SUBMIT_STEPS.length - 1) return;
    const t = setTimeout(() => {
      if (apiResponse) {
        const a = apiResponse.analysis;
        const stack = a.tech_stack.length > 0 ? a.tech_stack : [];
        setListing({
          id: apiResponse.tool.id,
          name: a.name,
          description: a.description,
          category: a.category,
          stack,
          inputs: a.input_contract,
          outputs: a.output_contract,
          language: a.language || inferLanguage(stack),
          license: a.license || "MIT",
        });
        if (a.pricing_model === "buy" || a.pricing_model === "royalty") {
          setPricingModel(a.pricing_model);
        }
        if (a.suggested_price_cents > 0) {
          setAmount(String(Math.round(a.suggested_price_cents / 100)));
        }
      } else {
        setListing({ ...AUTO_LISTING });
      }
      setPhase("review");
    }, 320);
    return () => clearTimeout(t);
  }, [phase, step, apiReady, apiResponse]);

  // ── Review form helpers ─────────────────────────────────────────────────────
  function patch(p: Partial<Listing>) {
    setListing((l) => (l ? { ...l, ...p } : l));
  }
  function addStack() {
    if (!listing) return;
    const v = stackInput.trim().replace(/,$/, "");
    if (!v || listing.stack.includes(v)) return;
    patch({ stack: [...listing.stack, v] });
    setStackInput("");
  }
  function removeStack(s: string) {
    if (!listing) return;
    patch({ stack: listing.stack.filter((x) => x !== s) });
  }

  async function submitForReview() {
    if (!listing) return;
    if (!amount || Number(amount) <= 0) return;

    // PUT back any edits if this came from the API. Auth will 401 (we're not
    // signed in as the system seller), and that's fine — the draft is already
    // saved in the DB from the /tools/submit call. We just advance to `done`.
    if (listing.id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = {
          name: listing.name,
          description: listing.description,
          documentation:
            `# ${listing.name}\n\n${listing.description}\n\n` +
            `**Tech stack:** ${listing.stack.join(", ") || "unspecified"}\n\n` +
            `## Input\n${listing.inputs}\n\n## Output\n${listing.outputs}\n`,
        };
        const cents = Math.round(Number(amount)) * 100;
        if (pricingModel === "buy") {
          body.ownership_type = "full_sale";
          body.one_time_price = cents / 100;
        } else {
          body.ownership_type = "royalty";
          body.price_per_request = cents / 100;
        }
        await api.put(`/tools/${listing.id}`, body);
      } catch {
        // Expected: 401 (no auth) — fall through to `done` anyway.
      }
    }

    const cents = Math.max(0, Math.round(Number(amount)) * 100);
    const record = newSubmissionFromAnalysis({
      github_url: url || "https://github.com/example/repo",
      submitter_email: "demo@hackmarket.io",
      name: listing.name,
      description: listing.description,
      category: listing.category,
      tech_stack: listing.stack,
      inputs: listing.inputs,
      outputs: listing.outputs,
      pricing_model: pricingModel,
      price_cents: cents,
    });
    upsertSubmission(record);
    setSubmissionRecord(record);

    setPhase("done");
  }

  function reset() {
    setPhase("input");
    setUrl("");
    setUrlError("");
    setStep(-1);
    setListing(null);
    setStackInput("");
    setAmount("");
    setPricingModel("buy");
    setApiResponse(null);
    setApiReady(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const canSubmit = !!amount && Number(amount) > 0;

  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .submit-fade-up { animation: fadeUp 0.32s ease both; }
        .submit-spinner {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid var(--border); border-top-color: var(--blue);
          animation: spin 0.8s linear infinite;
        }
        .submit-input:focus, .submit-textarea:focus { border-color: var(--blue) !important; }
        .submit-textarea { scrollbar-width: thin; }
      `}</style>

      <main
        style={{
          minHeight: PAGE_MIN_HEIGHT,
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: phase === "review" ? "16px 24px 32px" : "60px 24px",
          boxSizing: "border-box",
        }}
      >
        {phase === "input" && (
          <InputPhase
            url={url}
            urlError={urlError}
            setUrl={(v) => {
              setUrl(v);
              setUrlError("");
            }}
            analyze={analyze}
          />
        )}

        {phase === "analyzing" && <AnalyzingPhase url={url} step={step} />}

        {phase === "review" && listing && (
          <ReviewPhase
            listing={listing}
            patch={patch}
            url={url}
            stackInput={stackInput}
            setStackInput={setStackInput}
            addStack={addStack}
            removeStack={removeStack}
            pricingModel={pricingModel}
            setPricingModel={setPricingModel}
            amount={amount}
            setAmount={setAmount}
            canSubmit={canSubmit}
            onSubmit={submitForReview}
            onReset={reset}
          />
        )}

        {phase === "done" && (
          <DonePhase
            submissionRecord={submissionRecord}
            listingName={listing?.name}
            onReset={reset}
          />
        )}
      </main>
    </>
  );
}

// ─── Phase: input ────────────────────────────────────────────────────────────

function InputPhase({
  url,
  urlError,
  setUrl,
  analyze,
}: {
  url: string;
  urlError: string;
  setUrl: (v: string) => void;
  analyze: () => void;
}) {
  return (
    <div className="submit-fade-up" style={{ width: "100%", maxWidth: 720 }}>
      <div style={{ marginBottom: 28 }}>
        <Badge>Submit a build</Badge>
        <h1
          style={{
            fontFamily: "var(--font-display, var(--font-serif))",
            fontSize: "clamp(24px, 3.6vw, 32px)",
            fontWeight: 700,
            color: "var(--text)",
            lineHeight: 1.2,
            margin: "14px 0 0",
          }}
        >
          Submit your build.
        </h1>
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 28,
        }}
      >
        <Caption>Paste your GitHub repo URL</Caption>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <input
            type="url"
            placeholder="https://github.com/you/your-hack"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") analyze();
            }}
            className="submit-input"
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: 10,
              border: `1.5px solid ${urlError ? "#ef4444" : "var(--border)"}`,
              background: "var(--bg)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 13.5,
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
          />
          <button
            onClick={analyze}
            disabled={!url.trim()}
            style={{
              padding: "12px 22px",
              borderRadius: 10,
              background: "var(--blue)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              border: "none",
              cursor: url.trim() ? "pointer" : "not-allowed",
              opacity: url.trim() ? 1 : 0.5,
              whiteSpace: "nowrap",
            }}
          >
            Analyze →
          </button>
        </div>
        {urlError && (
          <p
            style={{
              color: "#ef4444",
              fontSize: 12.5,
              margin: "6px 0 0",
              fontFamily: "var(--font-mono)",
            }}
          >
            {urlError}
          </p>
        )}
        <p
          style={{
            color: "var(--muted)",
            fontSize: 13.5,
            margin: "16px 0 0",
            lineHeight: 1.55,
          }}
        >
          That&rsquo;s the whole submission. We&rsquo;ll read the repo, detect the stack, write
          the description, and draft your I/O contract. You just review and pick how you want to
          get paid.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "20px 0 12px",
        }}
      >
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>or try an example</span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {EXAMPLE_REPOS.map((u) => (
          <button
            key={u}
            onClick={() => setUrl(u)}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {u.replace("https://github.com/", "")}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Phase: analyzing ────────────────────────────────────────────────────────

function AnalyzingPhase({ url, step }: { url: string; step: number }) {
  return (
    <div className="submit-fade-up" style={{ width: "100%", maxWidth: 720, margin: "auto 0" }}>
      <div style={{ marginBottom: 22 }}>
        <Badge>Analyzing</Badge>
        <h1
          style={{
            fontFamily: "var(--font-display, var(--font-serif))",
            fontSize: "clamp(22px, 3vw, 28px)",
            fontWeight: 700,
            color: "var(--text)",
            lineHeight: 1.2,
            margin: "14px 0 0",
          }}
        >
          Reading your repo…
        </h1>
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "12px 16px",
          marginBottom: 16,
        }}
      >
        <Caption>Repository</Caption>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13.5,
            color: "var(--text)",
            wordBreak: "break-all",
            marginTop: 4,
          }}
        >
          {url}
        </div>
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display, var(--font-serif))",
              fontWeight: 700,
              fontSize: 16,
              color: "var(--text)",
            }}
          >
            Analyzing your repo
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            {Math.min(step + 1, SUBMIT_STEPS.length)}/{SUBMIT_STEPS.length}
          </div>
        </div>

        <div
          style={{
            height: 3,
            background: "var(--border)",
            borderRadius: 99,
            overflow: "hidden",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: `${(Math.min(step + 1, SUBMIT_STEPS.length) / SUBMIT_STEPS.length) * 100}%`,
              height: "100%",
              background: "var(--blue)",
              transition: "width 0.4s ease",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {SUBMIT_STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div
                key={s}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  opacity: done || active ? 1 : 0.4,
                  transition: "opacity 0.3s",
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {done ? (
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "var(--green, #22c55e)",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ✓
                    </div>
                  ) : active ? (
                    <div className="submit-spinner" />
                  ) : (
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--border)",
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    color: active ? "var(--text)" : "var(--muted)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {s}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Phase: review (dense grid, no scroll) ───────────────────────────────────

function ReviewPhase({
  listing,
  patch,
  url,
  stackInput,
  setStackInput,
  addStack,
  removeStack,
  pricingModel,
  setPricingModel,
  amount,
  setAmount,
  canSubmit,
  onSubmit,
  onReset,
}: {
  listing: Listing;
  patch: (p: Partial<Listing>) => void;
  url: string;
  stackInput: string;
  setStackInput: (v: string) => void;
  addStack: () => void;
  removeStack: (s: string) => void;
  pricingModel: PricingModel;
  setPricingModel: (m: PricingModel) => void;
  amount: string;
  setAmount: (v: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className="submit-fade-up"
      style={{
        width: "100%",
        maxWidth: 1280,
        height: "100%",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gap: 12,
        minHeight: 0,
      }}
    >
      {/* ── Top bar: badge + auto-gen banner + fixed repo URL ───────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Badge>Review</Badge>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 11px",
              borderRadius: 8,
              background: "var(--elevated)",
              border: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              minWidth: 0,
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>
              Auto-generated from your repo — edit anything, pick a price, ship it.
            </span>
          </div>
        </div>
        {/* Fixed repo URL — never out of view */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 11px",
            borderRadius: 8,
            background: "var(--card)",
            border: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            maxWidth: 420,
          }}
        >
          <span style={{ color: "var(--muted)", flexShrink: 0 }}>repo:</span>
          <span
            style={{
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {url.replace("https://github.com/", "") || "—"}
          </span>
        </div>
      </div>

      {/* ── Main two-column grid ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gridTemplateRows: "auto 1fr",
          gap: 12,
          minHeight: 0,
        }}
      >
        {/* ─── Top-left: Name + Description ───────────────────────────────── */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minHeight: 0,
          }}
        >
          <FieldLabel>Name</FieldLabel>
          <input
            value={listing.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="submit-input"
            style={{
              ...inputStyle,
              fontSize: 17,
              fontFamily: "var(--font-display, var(--font-serif))",
              fontWeight: 700,
              padding: "9px 12px",
            }}
          />
          <FieldLabel>
            Description
          </FieldLabel>
          <textarea
            rows={4}
            value={listing.description}
            onChange={(e) => patch({ description: e.target.value })}
            className="submit-textarea submit-input"
            style={{
              ...inputStyle,
              flex: 1,
              minHeight: 0,
              resize: "none",
              fontFamily: "var(--font-body)",
              padding: "10px 12px",
              lineHeight: 1.5,
            }}
          />
        </div>

        {/* ─── Top-right: 2×2 detail grid ─────────────────────────────────── */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 14,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "auto auto",
            gap: 12,
            minHeight: 0,
          }}
        >
          {/* Category */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <FieldLabel>Category</FieldLabel>
            <CategoryPicker
              selected={listing.category}
              onChange={(c) => patch({ category: c })}
            />
          </div>

          {/* Language */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <FieldLabel>Language</FieldLabel>
            <input
              value={listing.language}
              onChange={(e) => patch({ language: e.target.value })}
              className="submit-input"
              style={{ ...inputStyle, padding: "8px 12px" }}
            />
            <FieldLabel>License</FieldLabel>
            <input
              value={listing.license}
              onChange={(e) => patch({ license: e.target.value })}
              className="submit-input"
              style={{ ...inputStyle, padding: "8px 12px" }}
            />
          </div>

          {/* Tech stack — spans full width */}
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
            }}
          >
            <FieldLabel>
              Tech stack
            </FieldLabel>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                padding: "7px 9px",
                border: "1.5px solid var(--border)",
                borderRadius: 9,
                background: "var(--bg)",
                minHeight: 38,
                alignItems: "center",
              }}
            >
              {listing.stack.map((s) => (
                <span
                  key={s}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    fontSize: 11.5,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                  }}
                >
                  {s}
                  <span
                    onClick={() => removeStack(s)}
                    style={{
                      cursor: "pointer",
                      color: "var(--muted)",
                      fontSize: 13,
                      lineHeight: 1,
                      userSelect: "none",
                    }}
                  >
                    ×
                  </span>
                </span>
              ))}
              <input
                value={stackInput}
                onChange={(e) => setStackInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addStack();
                  } else if (
                    e.key === "Backspace" &&
                    !stackInput &&
                    listing.stack.length
                  ) {
                    removeStack(listing.stack[listing.stack.length - 1]);
                  }
                }}
                placeholder={listing.stack.length ? "Add another…" : "Add a tag…"}
                style={{
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  flex: 1,
                  minWidth: 80,
                  padding: "3px 0",
                }}
              />
            </div>
          </div>
        </div>

        {/* ─── Bottom-left: Inputs ─────────────────────────────────────────── */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 0,
          }}
        >
          <FieldLabel>Inputs</FieldLabel>
          <textarea
            value={listing.inputs}
            onChange={(e) => patch({ inputs: e.target.value })}
            className="submit-textarea submit-input"
            style={{
              ...inputStyle,
              flex: 1,
              minHeight: 0,
              resize: "none",
              fontFamily: "var(--font-body)",
              padding: "10px 12px",
              lineHeight: 1.5,
            }}
          />
        </div>

        {/* ─── Bottom-right: Outputs ───────────────────────────────────────── */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 0,
          }}
        >
          <FieldLabel>Outputs</FieldLabel>
          <textarea
            value={listing.outputs}
            onChange={(e) => patch({ outputs: e.target.value })}
            className="submit-textarea submit-input"
            style={{
              ...inputStyle,
              flex: 1,
              minHeight: 0,
              resize: "none",
              fontFamily: "var(--font-body)",
              padding: "10px 12px",
              lineHeight: 1.5,
            }}
          />
        </div>
      </div>

      {/* ── Footer: pricing toggle + price + submit (sticky-by-grid) ─────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        {/* Left: Pricing model toggle + helper */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 12,
            display: "grid",
            gridTemplateColumns: "auto 1fr 1fr",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Pricing</div>
          {(["buy", "royalty"] as const).map((mode) => {
            const selected = pricingModel === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setPricingModel(mode)}
                style={{
                  padding: "9px 12px",
                  borderRadius: 9,
                  border: `1.5px solid ${selected ? "var(--blue)" : "var(--border)"}`,
                  background: selected ? "rgba(59,130,246,0.10)" : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: selected ? "var(--blue)" : "var(--text)",
                  }}
                >
                  {mode === "buy" ? "Lump sum" : "Royalty / mo"}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    lineHeight: 1.3,
                  }}
                >
                  {mode === "buy" ? "One payment, walk away." : "Earn per integration / mo."}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Price input + Submit */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 10,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "8px 12px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 4,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
              {pricingModel === "buy" ? "Price (USD)" : "Per month (USD)"} · you earn 80%
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: 18,
                  fontWeight: 600,
                  marginRight: 4,
                }}
              >
                $
              </span>
              <input
                type="number"
                placeholder={pricingModel === "buy" ? "1200" : "45"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontFamily: "var(--font-display, var(--font-serif))",
                  fontWeight: 700,
                  fontSize: 22,
                  width: "100%",
                  minWidth: 0,
                  padding: 0,
                }}
              />
              {pricingModel === "royalty" && (
                <span
                  style={{
                    color: "var(--muted)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    whiteSpace: "nowrap",
                    marginLeft: 6,
                  }}
                >
                  / mo
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              style={{
                padding: "14px 28px",
                borderRadius: 12,
                background: "var(--blue)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                border: "none",
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? 1 : 0.4,
                transition: "opacity 0.15s",
                whiteSpace: "nowrap",
                flex: 1,
                minHeight: 0,
                boxShadow: canSubmit ? "0 8px 24px rgba(59,130,246,0.28)" : "none",
              }}
            >
              Submit for review →
            </button>
            <button
              onClick={onReset}
              style={{
                padding: "4px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--muted)",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              ← Start over
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Phase: done ─────────────────────────────────────────────────────────────

function DonePhase({
  submissionRecord,
  listingName,
  onReset,
}: {
  submissionRecord: SubmissionRecord | null;
  listingName?: string;
  onReset: () => void;
}) {
  return (
    <div
      className="submit-fade-up"
      style={{
        textAlign: "center",
        margin: "auto 0",
        maxWidth: 520,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "rgba(34,197,94,0.12)",
          border: "2px solid var(--green, #22c55e)",
          color: "var(--green, #22c55e)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 32,
          fontWeight: 700,
          margin: "0 auto 24px",
        }}
      >
        ✓
      </div>
      <h2
        style={{
          fontFamily: "var(--font-display, var(--font-serif))",
          fontSize: "clamp(22px, 3.2vw, 28px)",
          fontWeight: 700,
          color: "var(--text)",
          margin: "0 0 12px",
        }}
      >
        Submitted for review.
      </h2>
      <p
        style={{
          color: "var(--muted)",
          fontSize: 15,
          lineHeight: 1.6,
          margin: "0 auto",
        }}
      >
        Manual review within 48 hours. You&rsquo;ll get an email when{" "}
        {listingName ? <strong>{listingName}</strong> : "your listing"} goes live.
      </p>
      <div
        style={{
          display: "flex",
          gap: 10,
          justifyContent: "center",
          marginTop: 32,
          flexWrap: "wrap",
        }}
      >
        {submissionRecord && (
          <Link
            href={`/submit/${submissionRecord.id}/status`}
            style={{
              padding: "13px 22px",
              borderRadius: 11,
              background: "var(--blue)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            Track status →
          </Link>
        )}
        <Link
          href="/dashboard"
          style={{
            padding: "13px 22px",
            borderRadius: 11,
            background: submissionRecord ? "transparent" : "var(--blue)",
            color: submissionRecord ? "var(--text)" : "#fff",
            border: submissionRecord ? "1.5px solid var(--border)" : "none",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          View dashboard
        </Link>
        <button
          onClick={onReset}
          style={{
            padding: "13px 22px",
            borderRadius: 11,
            border: "1.5px solid var(--border)",
            background: "transparent",
            color: "var(--muted)",
            fontWeight: 500,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Submit another
        </button>
      </div>
    </div>
  );
}

// ─── Shared inline bits ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 9,
  border: "1.5px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--blue)",
        background: "rgba(59,130,246,0.10)",
        border: "1px solid rgba(59,130,246,0.25)",
        borderRadius: 99,
        padding: "3px 10px",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {children}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {children}
    </div>
  );
}

function FieldLabel({
  children,
}: {
  children: React.ReactNode;
  /** Kept for compat — the AUTO badge was removed; pass nothing. */
  auto?: boolean;
  autoNote?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        fontFamily: "var(--font-mono)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Category picker (single selected pill + searchable popover) ────────

function CategoryPicker({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? CATEGORIES.filter((c) => c.toLowerCase().includes(q))
    : CATEGORIES;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: 999,
            border: "1px solid var(--blue)",
            background: "rgba(59,130,246,0.12)",
            color: "var(--blue)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {selected || "—"}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: "5px 10px",
            borderRadius: 999,
            border: "1px dashed var(--border)",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 11.5,
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {open ? "Close" : "+ Change"}
        </button>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 16px 36px rgba(0,0,0,0.10)",
            padding: 8,
            minWidth: 260,
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter categories…"
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 12.5,
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "8px 10px",
                  color: "var(--muted)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                No matches
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                    setQuery("");
                  }}
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    borderRadius: 7,
                    border: "none",
                    background:
                      c === selected ? "rgba(59,130,246,0.10)" : "transparent",
                    color: c === selected ? "var(--blue)" : "var(--text)",
                    fontSize: 12.5,
                    fontFamily: "var(--font-mono)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (c !== selected)
                      e.currentTarget.style.background = "var(--bg)";
                  }}
                  onMouseLeave={(e) => {
                    if (c !== selected)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  {c === selected ? "✓ " : "  "}
                  {c}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
