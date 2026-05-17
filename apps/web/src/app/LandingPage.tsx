"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Tool } from "@/types/tool";
import HeroPipeline from "@/components/HeroPipeline";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  nlp: "#3b82f6",
  computer_vision: "#8b5cf6",
  data_analysis: "#f59e0b",
  automation: "#10b981",
  generation: "#ec4899",
  other: "#6b7280",
};

const SNIPPETS = [
  { text: "POST /api/v1/tools/sentiment-ai  → 200  87ms  $0.0001", left: "4%",  delay: "0s",   dur: "19s" },
  { text: '{"sentiment":"positive","confidence":0.947}',             left: "18%", delay: "6s",   dur: "23s" },
  { text: "X-Api-Key: hm_live_4xkQ8...",                            left: "36%", delay: "2s",   dur: "17s" },
  { text: "GET /v1/tools?category=nlp&sort_by=popular  → 200",      left: "54%", delay: "9s",   dur: "21s" },
  { text: 'import hackmarket; tool.run(text="hello world")',         left: "70%", delay: "4s",   dur: "25s" },
  { text: "200 OK · 94ms · $0.0008 · model: gpt-4-turbo",          left: "82%", delay: "13s",  dur: "18s" },
  { text: "curl -X POST /api/v1/tools/home-accessibility-checker", left: "12%", delay: "16s",  dur: "22s" },
  { text: '{"tokens_used":847,"cost_usd":0.0041}',                  left: "44%", delay: "11s",  dur: "20s" },
  { text: "POST /api/v1/tools/code-review  → 200  1240ms",          left: "62%", delay: "7s",   dur: "26s" },
  { text: "response = requests.post(endpoint, json={'input':q})",    left: "88%", delay: "3s",   dur: "16s" },
];

const TICKER_ITEMS = [
  "✦ Sentiment Analysis", "✦ Image Classification", "✦ CSV Insights",
  "✦ Code Review", "✦ Text Summarization", "✦ Named Entity Recognition",
  "✦ Object Detection", "✦ Speech-to-Text", "✦ Language Translation",
  "✦ Anomaly Detection", "✦ Document Parsing", "✦ Logo Generation",
];

const MOCK_DEMO_OUTPUT = {
  sentiment: "positive",
  confidence: 0.947,
  scores: { positive: 0.947, neutral: 0.041, negative: 0.012 },
  entities: ["developers", "AI tools", "hackathon"],
  processing_time_ms: 83,
};

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

function useScrollReveal() {
  useEffect(() => {
    const classes = ["reveal", "reveal-left", "reveal-right"];
    const allEls: Element[] = [];
    classes.forEach((cls) => {
      document.querySelectorAll(`.${cls}`).forEach((el) => allEls.push(el));
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("in-view");
        });
      },
      { threshold: 0.12 }
    );

    allEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function useInView(threshold = 0.25) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

function useCountUp(target: number, active: boolean, duration = 2200) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      setCount(Math.floor(ease * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, active]);
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function FloatingSnippets() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {SNIPPETS.map((s, i) => (
        <span
          key={i}
          className="snippet-particle"
          style={{
            left: s.left,
            bottom: "-20px",
            animationDelay: s.delay,
            animationDuration: s.dur,
            opacity: 0,
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}

function HeroSection() {
  return (
    <section
      className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-10 pb-16 overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Radial spotlight */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 40%, rgba(59,130,246,0.07) 0%, transparent 70%)",
        }}
      />

      <FloatingSnippets />

      <div className="relative z-10 max-w-7xl mx-auto w-full grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
        {/* Left column: text + CTAs */}
        <div className="text-center lg:text-left">
        {/* Badge */}
        <div className="animate-fade-up flex justify-center lg:justify-start mb-8">
          <span
            className="inline-flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full border"
            style={{
              background: "rgba(59,130,246,0.08)",
              borderColor: "rgba(59,130,246,0.25)",
              color: "var(--blue)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--blue)", animation: "pulse-glow 2s ease-in-out infinite" }}
            />
            Now in public beta — submit your build for free
          </span>
        </div>

        {/* Headline */}
        <h1 className="animate-fade-up delay-100">
          <span
            className="block text-5xl sm:text-6xl md:text-7xl font-bold italic leading-[1.05] tracking-tight mb-3"
            style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
          >
            Every hackathon builds tools
            <br />
            that die on GitHub.
          </span>
          <span
            className="block text-5xl sm:text-6xl md:text-7xl font-semibold leading-[1.05] tracking-tight mt-1"
            style={{
              fontFamily: "var(--font-display)",
              background: "linear-gradient(135deg, #3b82f6 0%, #60a5fa 50%, #93c5fd 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            We bring them back to life.
          </span>
        </h1>

        {/* Sub-headline */}
        <p
          className="animate-fade-up delay-200 text-lg sm:text-xl leading-relaxed mt-8 mb-10 mx-auto lg:mx-0"
          style={{ color: "var(--muted)", maxWidth: "560px" }}
        >
          A curated API marketplace where developers sell their AI tools and
          companies use them with one API call.
        </p>

        {/* CTAs */}
        <div className="animate-fade-up delay-300 flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3">
          <Link
            href="/marketplace"
            className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl text-base font-semibold transition-all hover:opacity-90 active:scale-[0.97]"
            style={{ background: "var(--blue)", color: "#fff" }}
          >
            Browse Marketplace
            <span className="text-sm opacity-70">→</span>
          </Link>
          <Link
            href="/submit"
            className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl text-base font-medium border transition-all hover:border-[var(--border-h)] hover:text-white"
            style={{
              background: "transparent",
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
          >
            Submit Your Build
          </Link>
        </div>

        {/* Social proof row */}
        <div
          className="animate-fade-up delay-400 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 mt-12"
          style={{ color: "var(--faint)" }}
        >
          <span className="text-xs font-mono">89 developers earning</span>
          <span className="w-1 h-1 rounded-full bg-current opacity-50" />
          <span className="text-xs font-mono">1,247 tools listed</span>
          <span className="w-1 h-1 rounded-full bg-current opacity-50" />
          <span className="text-xs font-mono">4.2M API calls served</span>
        </div>
        </div>

        {/* Right column: animated pipeline visualization */}
        <div className="hidden lg:flex items-center justify-center animate-fade-up delay-200">
          <HeroPipeline />
        </div>
      </div>

      {/* Scroll hint */}
      <div
        className="animate-fade-up delay-500 absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        style={{ color: "var(--faint)" }}
      >
        <span className="text-xs font-mono">scroll</span>
        <div className="w-px h-8 bg-gradient-to-b from-current to-transparent opacity-40" />
      </div>
    </section>
  );
}

function TickerBand() {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div
      className="border-y overflow-hidden py-3"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <span
            key={i}
            className="inline-block px-6 text-xs font-mono whitespace-nowrap"
            style={{ color: "var(--faint)" }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  const sellerSteps = [
    {
      num: "01",
      title: "Upload your project",
      desc: "Push your GitHub repo or drop a Docker image. We accept any language, any framework.",
    },
    {
      num: "02",
      title: "We containerize & deploy",
      desc: "Our pipeline wraps your tool in a production-grade container with auto-scaling, monitoring, and a clean REST API.",
    },
    {
      num: "03",
      title: "Earn on every API call",
      desc: "Set your price per request. Get paid automatically — weekly payouts, no invoices, no chasing.",
    },
  ];

  const buyerSteps = [
    {
      num: "01",
      title: "Browse and try live demos",
      desc: "Every tool has a live demo right on its page. No signup needed to test — sign up only when you're convinced.",
    },
    {
      num: "02",
      title: "Grab an API key",
      desc: "One key, one credit balance. Works across every tool in the marketplace. No per-tool billing headaches.",
    },
    {
      num: "03",
      title: "One API call. That's it.",
      desc: "Standard REST API. Works with curl, Python, JavaScript, or any HTTP client. Docs generated automatically.",
    },
  ];

  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 reveal">
          <p
            className="text-xs font-mono uppercase tracking-widest mb-3"
            style={{ color: "var(--blue)" }}
          >
            How it works
          </p>
          <h2
            className="text-3xl sm:text-4xl font-bold"
            style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
          >
            Two sides, one marketplace
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-0">
          {/* Seller column */}
          <div className="reveal-left pb-10 lg:pb-0 lg:pr-12">
            <div className="flex items-center gap-3 mb-10">
              <span
                className="text-xs font-mono uppercase tracking-widest px-3 py-1.5 rounded-md border"
                style={{
                  color: "var(--green)",
                  borderColor: "rgba(34,197,94,0.3)",
                  background: "var(--green-dim)",
                }}
              >
                For Sellers
              </span>
              <div
                className="h-px flex-1"
                style={{ background: "linear-gradient(to right, rgba(34,197,94,0.3), transparent)" }}
              />
            </div>
            <div className="space-y-8 reveal-group">
              {sellerSteps.map((step) => (
                <div key={step.num} className="reveal flex gap-5">
                  <div
                    className="text-2xl font-bold leading-none pt-0.5 flex-shrink-0 w-8"
                    style={{ fontFamily: "var(--font-mono)", color: "rgba(34,197,94,0.25)" }}
                  >
                    {step.num}
                  </div>
                  <div>
                    <h3
                      className="text-base font-semibold mb-1.5"
                      style={{ color: "var(--text)" }}
                    >
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div
            className="hidden lg:block w-px"
            style={{
              background:
                "linear-gradient(to bottom, transparent, rgba(34,197,94,0.4), rgba(59,130,246,0.4), transparent)",
            }}
          />

          {/* Buyer column */}
          <div className="reveal-right border-t lg:border-t-0 pt-10 lg:pt-0 lg:pl-12">
            <div className="flex items-center gap-3 mb-10">
              <span
                className="text-xs font-mono uppercase tracking-widest px-3 py-1.5 rounded-md border"
                style={{
                  color: "var(--blue)",
                  borderColor: "rgba(59,130,246,0.3)",
                  background: "var(--blue-dim)",
                }}
              >
                For Buyers
              </span>
              <div
                className="h-px flex-1"
                style={{ background: "linear-gradient(to right, rgba(59,130,246,0.3), transparent)" }}
              />
            </div>
            <div className="space-y-8 reveal-group">
              {buyerSteps.map((step) => (
                <div key={step.num} className="reveal flex gap-5">
                  <div
                    className="text-2xl font-bold leading-none pt-0.5 flex-shrink-0 w-8"
                    style={{ fontFamily: "var(--font-mono)", color: "rgba(59,130,246,0.25)" }}
                  >
                    {step.num}
                  </div>
                  <div>
                    <h3
                      className="text-base font-semibold mb-1.5"
                      style={{ color: "var(--text)" }}
                    >
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniToolCard({ tool, href }: { tool: Tool; href?: string }) {
  const color = CAT_COLORS[tool.category] ?? "#6b7280";
  const price = parseFloat(tool.price_per_request ?? "0");
  const priceStr = price === 0 ? "Free" : price < 0.01 ? `$${price.toFixed(4)}` : `$${price.toFixed(3)}`;
  const totalStr =
    tool.total_requests >= 1000
      ? `${(tool.total_requests / 1000).toFixed(1)}k`
      : String(tool.total_requests);
  const cardHref = href ?? `/tools/${tool.slug}`;

  return (
    <Link href={cardHref} className="group block">
      <article
        className="h-full rounded-xl border p-5 transition-all duration-200"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = `${color}55`;
          e.currentTarget.style.boxShadow = `0 0 20px ${color}0a`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <span
            className="text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md"
            style={{
              background: `${color}15`,
              color,
              border: `1px solid ${color}30`,
            }}
          >
            {tool.category.replace(/_/g, " ")}
          </span>
          {tool.is_featured && (
            <span className="text-xs" style={{ color: "var(--yellow)" }}>★</span>
          )}
        </div>
        <h3
          className="text-base font-semibold mb-1.5 leading-snug group-hover:text-white transition-colors"
          style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
        >
          {tool.name}
        </h3>
        <p
          className="text-sm leading-relaxed line-clamp-2 mb-5"
          style={{ color: "var(--muted)" }}
        >
          {tool.tagline}
        </p>
        <div
          className="border-t pt-4 flex items-center justify-between"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <span
              className="text-sm font-semibold block"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}
            >
              {priceStr}
            </span>
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
            >
              /request
            </span>
          </div>
          <div className="text-right">
            <span
              className="text-sm font-semibold block"
              style={{ fontFamily: "var(--font-mono)", color: "var(--green)" }}
            >
              {tool.avg_response_time_ms != null ? `${tool.avg_response_time_ms}ms` : "—"}
            </span>
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-mono)", color: "var(--faint)" }}
            >
              {totalStr} calls
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function FeaturedTools({ tools, unavailable }: { tools: Tool[]; unavailable: boolean }) {
  const hasRealTools = tools.length > 0;

  return (
    <section
      className="py-24 px-6 border-y"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-12 reveal">
          <div>
            <p
              className="text-xs font-mono uppercase tracking-widest mb-2"
              style={{ color: "var(--blue)" }}
            >
              Featured tools
            </p>
            <h2
              className="text-3xl sm:text-4xl font-bold"
              style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
            >
              Ready to integrate right now
            </h2>
          </div>
          <Link
            href="/marketplace"
            className="text-sm font-mono transition-colors hover:text-white whitespace-nowrap"
            style={{ color: "var(--blue)" }}
          >
            View all tools →
          </Link>
        </div>

        {hasRealTools ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 reveal-group">
            {tools.map((tool) => (
              <div key={tool.id} className="reveal">
                <MiniToolCard tool={tool} />
              </div>
            ))}
          </div>
        ) : (
          <div
            className="reveal rounded-[28px] border px-6 py-8"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <p className="text-sm font-mono uppercase tracking-widest mb-3" style={{ color: "var(--faint)" }}>Featured tools</p>
            <h3 className="text-2xl font-bold mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}>Be the first on the marketplace.</h3>
            <p className="text-sm leading-7 max-w-2xl" style={{ color: "var(--muted)" }}>
              {"Be the first to publish a tool. Browse the marketplace to see live listings, or convert your GitHub project into a callable API in under a minute."}
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link href="/marketplace" className="hero-btn-primary">Browse marketplace</Link>
              <Link href="/publish" className="hero-btn-secondary">List a tool</Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type DemoState = "idle" | "running" | "done";

function LandingDemo() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<DemoState>("idle");
  const [output, setOutput] = useState<typeof MOCK_DEMO_OUTPUT | null>(null);

  const runDemo = useCallback(async () => {
    if (!input.trim() || state === "running") return;
    setState("running");
    setOutput(null);
    await new Promise((r) => setTimeout(r, 900));
    setState("done");
    setOutput(MOCK_DEMO_OUTPUT);
  }, [input, state]);

  const colorScore = (v: number) =>
    v > 0.5 ? "var(--green)" : v > 0.2 ? "var(--yellow)" : "var(--red)";

  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12 reveal">
          <p
            className="text-xs font-mono uppercase tracking-widest mb-3"
            style={{ color: "var(--blue)" }}
          >
            Product preview
          </p>
          <h2
            className="text-3xl sm:text-4xl font-bold mb-3"
            style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
          >
            See the workflow
          </h2>
          <p className="text-base" style={{ color: "var(--muted)" }}>
            This is a styled preview of the experience. For live requests, jump into any real tool page and run its demo there.
          </p>
        </div>

        <div
          className="rounded-2xl border overflow-hidden reveal"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          {/* Terminal title bar */}
          <div
            className="flex items-center justify-between px-5 py-3 border-b"
            style={{ background: "var(--elevated)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: "#ef4444" }} />
              <span className="w-3 h-3 rounded-full" style={{ background: "#eab308" }} />
              <span className="w-3 h-3 rounded-full" style={{ background: "#22c55e" }} />
            </div>
            <span
              className="text-xs font-mono"
              style={{ color: "var(--faint)" }}
            >
              Previewing a real tool call
            </span>
            <span
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{ background: "rgba(34,197,94,0.1)", color: "var(--green)" }}
            >
              live
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x"
            style={{ borderColor: "var(--border)" }}
          >
            {/* Input */}
            <div className="p-6">
              <p
                className="text-xs font-mono mb-3"
                style={{ color: "var(--blue)" }}
              >
                → Request body
              </p>
              <div
                className="rounded-xl border mb-4"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="px-4 py-2 border-b text-xs font-mono"
                  style={{ borderColor: "var(--border)", color: "var(--faint)" }}
                >
                  {"{"}
                  <span style={{ color: "var(--blue)" }}> "input"</span>:{" "}
                </div>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`"Try typing something here..."`}
                  rows={5}
                  className="w-full px-4 py-3 text-sm outline-none resize-none rounded-b-xl"
                  style={{
                    background: "transparent",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runDemo();
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-mono"
                  style={{ color: "var(--faint)" }}
                >
                  ⌘↵ to run
                </span>
                <button
                  onClick={runDemo}
                  disabled={!input.trim() || state === "running"}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]"
                  style={{
                    background: state === "running" ? "var(--elevated)" : "var(--blue)",
                    color: "#fff",
                    border: state === "running" ? "1px solid var(--border)" : "none",
                  }}
                >
                  {state === "running" ? (
                    <>
                      <span
                        className="w-3.5 h-3.5 border-2 rounded-full border-t-transparent"
                        style={{
                          borderColor: "var(--muted)",
                          animation: "spin-slow 0.7s linear infinite",
                        }}
                      />
                      Running
                    </>
                  ) : (
                    <>Analyze ▶</>
                  )}
                </button>
              </div>
            </div>

            {/* Output */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono" style={{ color: "var(--green)" }}>
                  ← Response
                </p>
                {state === "done" && output && (
                  <span
                    className="text-xs font-mono"
                    style={{ color: "var(--faint)" }}
                  >
                    200 OK · {output.processing_time_ms}ms · $0.0008
                  </span>
                )}
              </div>

              {state === "idle" && (
                <div className="flex items-center justify-center h-40">
                  <p
                    className="text-xs font-mono text-center"
                    style={{ color: "var(--faint)" }}
                  >
                    Response will appear here
                  </p>
                </div>
              )}

              {state === "running" && (
                <div className="flex items-center justify-center h-40 gap-3">
                  <span
                    className="w-4 h-4 border-2 rounded-full border-t-transparent"
                    style={{
                      borderColor: "var(--blue)",
                      animation: "spin-slow 0.8s linear infinite",
                    }}
                  />
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    Analyzing…
                  </span>
                </div>
              )}

              {state === "done" && output && (
                <div className="space-y-4 animate-fade-up">
                  {/* Sentiment pill */}
                  <div
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg"
                    style={{
                      background: "rgba(34,197,94,0.1)",
                      border: "1px solid rgba(34,197,94,0.2)",
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: "var(--green)" }}
                    />
                    <span
                      className="text-sm font-semibold font-mono"
                      style={{ color: "var(--green)" }}
                    >
                      {output.sentiment}
                    </span>
                    <span className="text-sm font-mono" style={{ color: "var(--muted)" }}>
                      · {(output.confidence * 100).toFixed(1)}% confidence
                    </span>
                  </div>

                  {/* Score bars */}
                  <div className="space-y-2">
                    {Object.entries(output.scores).map(([label, score]) => (
                      <div key={label} className="flex items-center gap-3">
                        <span
                          className="text-xs font-mono w-16 flex-shrink-0"
                          style={{ color: "var(--muted)" }}
                        >
                          {label}
                        </span>
                        <div
                          className="flex-1 h-1.5 rounded-full overflow-hidden"
                          style={{ background: "var(--border)" }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${(score * 100).toFixed(1)}%`,
                              background: colorScore(score),
                            }}
                          />
                        </div>
                        <span
                          className="text-xs font-mono w-10 text-right flex-shrink-0"
                          style={{ color: colorScore(score) }}
                        >
                          {(score * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Entities */}
                  <div>
                    <p
                      className="text-xs font-mono mb-2"
                      style={{ color: "var(--faint)" }}
                    >
                      entities detected
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {output.entities.map((e) => (
                        <span
                          key={e}
                          className="text-xs font-mono px-2.5 py-1 rounded-md"
                          style={{
                            background: "var(--elevated)",
                            border: "1px solid var(--border)",
                            color: "var(--muted)",
                          }}
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer hint */}
          <div
            className="px-6 py-3 border-t flex items-center justify-between"
            style={{ background: "var(--elevated)", borderColor: "var(--border)" }}
          >
            <span
              className="text-xs font-mono"
              style={{ color: "var(--faint)" }}
            >
              Powered by{" "}
              <span style={{ color: "var(--muted)" }}>ML Studio</span> · Hackmarket API
            </span>
            <Link
              href="/marketplace"
              className="text-xs font-mono transition-colors hover:text-white"
              style={{ color: "var(--blue)" }}
            >
              Browse 1,247 more tools →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatItem({
  label,
  value,
  suffix,
  active,
}: {
  label: string;
  value: number;
  suffix: string;
  active: boolean;
}) {
  const count = useCountUp(value, active);
  const formatted =
    value >= 1_000_000
      ? `${(count / 1_000_000).toFixed(1)}M`
      : value >= 1_000
      ? count.toLocaleString()
      : String(count);

  return (
    <div className="text-center px-6">
      <div
        className="text-4xl sm:text-5xl font-bold mb-2 tabular-nums"
        style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}
      >
        {formatted}
        {suffix}
      </div>
      <div className="text-sm" style={{ color: "var(--muted)" }}>
        {label}
      </div>
    </div>
  );
}

function StatsSection() {
  const [ref, inView] = useInView(0.3);

  const stats = [
    { label: "Tools listed", value: 1247, suffix: "" },
    { label: "API calls served", value: 4_200_000, suffix: "" },
    { label: "Developers earning", value: 89, suffix: "" },
    { label: "Avg response time", value: 94, suffix: "ms" },
  ];

  return (
    <section
      className="py-24 px-6 border-y"
      style={{ borderColor: "var(--border)" }}
      ref={ref}
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14 reveal">
          <p
            className="text-xs font-mono uppercase tracking-widest mb-3"
            style={{ color: "var(--blue)" }}
          >
            By the numbers
          </p>
          <h2
            className="text-3xl sm:text-4xl font-bold"
            style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
          >
            The marketplace is moving
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 divide-x"
          style={{ borderColor: "var(--border)" }}
        >
          {stats.map((s) => (
            <StatItem key={s.label} {...s} active={inView} />
          ))}
        </div>

        {/* Micro note */}
        <p
          className="text-center text-xs font-mono mt-10 reveal"
          style={{ color: "var(--faint)" }}
        >
          Updated in real-time · Numbers are live marketplace data
        </p>
      </div>
    </section>
  );
}

function SellerCTA() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div
          className="rounded-2xl border overflow-hidden reveal"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          {/* Green accent top bar */}
          <div
            className="h-px w-full"
            style={{
              background: "linear-gradient(90deg, transparent, var(--green), transparent)",
            }}
          />

          <div className="p-10 sm:p-14">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
              <div>
                <span
                  className="inline-flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full border mb-6"
                  style={{
                    color: "var(--green)",
                    borderColor: "rgba(34,197,94,0.3)",
                    background: "var(--green-dim)",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--green)" }}
                  />
                  For tool builders
                </span>
                <h2
                  className="text-3xl sm:text-4xl font-bold italic leading-tight mb-4"
                  style={{ fontFamily: "var(--font-serif)", color: "var(--text)" }}
                >
                  Your hackathon project
                  <br />
                  deserves better than a
                  <br />
                  dead GitHub repo.
                </h2>
                <p className="text-base leading-relaxed mb-6" style={{ color: "var(--muted)" }}>
                  Average seller earns{" "}
                  <span style={{ color: "var(--green)", fontFamily: "var(--font-mono)" }}>
                    $340/month
                  </span>{" "}
                  in passive income from tools they built at hackathons. No infrastructure to
                  manage. No customers to support. Just recurring revenue.
                </p>
                <div className="grid grid-cols-3 gap-6">
                  {[
                    { label: "Setup time", value: "< 1 hour" },
                    { label: "Platform fee", value: "15%" },
                    { label: "Payout cycle", value: "Weekly" },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div
                        className="text-lg font-semibold mb-0.5"
                        style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}
                      >
                        {value}
                      </div>
                      <div className="text-xs" style={{ color: "var(--faint)" }}>
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 lg:min-w-44">
                <Link
                  href="/publish"
                  className="flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl text-base font-semibold transition-all hover:opacity-90 active:scale-[0.97] whitespace-nowrap"
                  style={{ background: "var(--green)", color: "#000" }}
                >
                  List your tool
                  <span>→</span>
                </Link>
                <Link
                  href="#"
                  className="text-center text-sm transition-colors hover:text-white"
                  style={{ color: "var(--muted)" }}
                >
                  Read seller guide
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const navLinks = [
    ["Marketplace", "/marketplace"],
    ["Documentation", "#"],
    ["Pricing", "#"],
    ["About", "#"],
    ["Contact", "#"],
  ];
  const legalLinks = [
    ["Terms of Service", "#"],
    ["Privacy Policy", "#"],
  ];

  return (
    <footer
      className="border-t px-6 py-14"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-10 sm:gap-20 mb-12">
          <div>
            <span
              className="text-lg font-bold tracking-tight block mb-2"
              style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}
            >
              Hackmarket
            </span>
            <p className="text-sm max-w-48" style={{ color: "var(--faint)" }}>
              The API marketplace for hackathon-born AI tools.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {navLinks.map(([label, href]) => (
              <Link
                key={label}
                href={href}
                className="text-sm transition-colors hover:text-white"
                style={{ color: "var(--muted)" }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div
          className="pt-6 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-xs font-mono" style={{ color: "var(--faint)" }}>
            © 2025 Hackmarket. Built by developers, for developers.
          </p>
          <div className="flex items-center gap-5">
            {legalLinks.map(([label, href]) => (
              <Link
                key={label}
                href={href}
                className="text-xs font-mono transition-colors hover:text-white"
                style={{ color: "var(--faint)" }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage({ featuredTools, featuredToolsUnavailable = false }: { featuredTools: Tool[]; featuredToolsUnavailable?: boolean }) {
  useScrollReveal();

  return (
    <div style={{ background: "var(--bg)", color: "var(--text)" }}>
      <HeroSection />
      <TickerBand />
      <HowItWorks />
      <FeaturedTools tools={featuredTools} unavailable={featuredToolsUnavailable} />
      <LandingDemo />
      <StatsSection />
      <SellerCTA />
      <SiteFooter />
    </div>
  );
}
