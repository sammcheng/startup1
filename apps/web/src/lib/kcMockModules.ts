// Local fallback catalog — the 10 kc "Rotshop" modules, ported with their
// keyword lists and matching logic so the discovery flow always has something
// to show even when the live DB is empty.
//
// Each module is normalised into Hackmarket's `Tool` shape so the existing
// MarketplaceClient ResultCard renders them with no special-casing.

import type { Tool, ToolCategory } from "@/types/tool";

// ─── kc-shape "category" string (different from Hackmarket's ToolCategory enum) ──

export type KcCategory =
  | "Auth"
  | "Payments"
  | "Notifications"
  | "Analytics"
  | "AI/ML"
  | "DevOps"
  | "UI Components"
  | "Data Pipelines";

export const KC_TO_TOOL_CATEGORY: Record<KcCategory, ToolCategory> = {
  Auth: "automation",
  Payments: "automation",
  Notifications: "automation",
  Analytics: "data_analysis",
  "AI/ML": "nlp",
  DevOps: "automation",
  "UI Components": "other",
  "Data Pipelines": "data_analysis",
};

export const CATEGORY_NOUN: Record<KcCategory, string> = {
  Auth: "authentication",
  Payments: "payment",
  Notifications: "notification",
  Analytics: "analytics",
  "AI/ML": "AI",
  DevOps: "observability",
  "UI Components": "UI",
  "Data Pipelines": "data pipeline",
};

interface KcModule {
  id: string;
  name: string;
  tagline: string;
  category: KcCategory;
  stack: string[];
  hackathon: string;
  pricing: { model: "buy" | "royalty"; amount: number };
  rating: number;
  integrations: number;
  complexity: "Easy" | "Medium" | "Advanced";
  keywords: string[];
  inputs: string;
  outputs: string;
  snippet: string;
  /** Returns a custom fit-line; receives the project descriptor + matched keywords. */
  fit: (project: string, hits: string[]) => string;
}

export const KC_MODULES: KcModule[] = [
  {
    id: "authforge",
    name: "AuthForge",
    tagline:
      "Drop-in OAuth2 + magic link authentication with session management.",
    category: "Auth",
    stack: ["Python", "FastAPI"],
    hackathon: "HackMIT 2025",
    pricing: { model: "buy", amount: 1200 },
    rating: 4.8,
    integrations: 67,
    complexity: "Easy",
    keywords: [
      "auth",
      "login",
      "sign in",
      "signup",
      "oauth",
      "session",
      "password",
      "sso",
      "identity",
      "user",
      "magic link",
      "jwt",
      "token",
      "access control",
    ],
    inputs:
      "User credentials (email/password or OAuth token), redirect URI, requested scopes.",
    outputs: "JWT session token, user profile object, refresh token.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/authforge/login \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "ada@example.com",
    "method": "magic_link",
    "redirect": "https://yourapp.com/callback"
  }'`,
    fit: (proj) =>
      `Handles user authentication and session management for ${proj}.`,
  },
  {
    id: "paypipe",
    name: "PayPipe",
    tagline: "Stripe subscription billing wrapper with usage metering.",
    category: "Payments",
    stack: ["Node.js", "Express"],
    hackathon: "TreeHacks 2025",
    pricing: { model: "royalty", amount: 45 },
    rating: 4.6,
    integrations: 43,
    complexity: "Medium",
    keywords: [
      "payment",
      "billing",
      "stripe",
      "subscription",
      "invoice",
      "checkout",
      "pricing",
      "charge",
      "revenue",
      "monetize",
      "plan",
      "tier",
      "usage",
    ],
    inputs: "Customer ID, plan selection, usage events.",
    outputs: "Subscription object, invoice URL, payment webhooks.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/paypipe/subscribe \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customer_id": "cus_8a2f",
    "plan": "pro_monthly",
    "metered": true
  }'`,
    fit: (proj) =>
      `Manages subscription billing and usage metering for ${proj}.`,
  },
  {
    id: "notifystack",
    name: "NotifyStack",
    tagline: "Multi-channel notifications across email, SMS, push, and in-app.",
    category: "Notifications",
    stack: ["TypeScript", "Bun"],
    hackathon: "CalHacks 2025",
    pricing: { model: "buy", amount: 800 },
    rating: 4.7,
    integrations: 89,
    complexity: "Easy",
    keywords: [
      "notification",
      "notifications",
      "email",
      "sms",
      "push",
      "alert",
      "alerts",
      "message",
      "notify",
      "template",
      "mail",
      "send",
    ],
    inputs:
      "Recipient ID, channel preference, template name, variables.",
    outputs:
      "Delivery status per channel, message ID, read receipts.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/notifystack/send \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "recipient_id": "u_42",
    "channels": ["email", "push"],
    "template": "alert_triggered",
    "vars": { "metric": "p95_latency" }
  }'`,
    fit: (proj, hits) => {
      const has = (k: string) => hits.includes(k);
      const what =
        has("email alerts") || has("alerts") ? "email alerts" : "multi-channel notifications";
      return `Delivers ${what} across email, SMS, and push for ${proj}.`;
    },
  },
  {
    id: "onboardkit",
    name: "OnboardKit",
    tagline: "Product tour and onboarding flow builder.",
    category: "UI Components",
    stack: ["React", "TypeScript"],
    hackathon: "HackSC 2025",
    pricing: { model: "royalty", amount: 30 },
    rating: 4.5,
    integrations: 34,
    complexity: "Easy",
    keywords: [
      "onboard",
      "onboarding",
      "tour",
      "ui",
      "component",
      "widget",
      "walkthrough",
      "guide",
      "tooltip",
      "wizard",
      "stepper",
      "welcome",
    ],
    inputs: "Step definitions, target elements, user segment rules.",
    outputs: "Completion events, drop-off analytics, engagement metrics.",
    snippet: `fetch('https://api.hackmarket.io/v1/onboardkit/track', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + HACKMARKET_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    user_id: 'u_42',
    flow: 'first_run',
    event: 'step_completed',
  }),
});`,
    fit: (proj) =>
      `Adds a guided product tour and onboarding flow to ${proj}.`,
  },
  {
    id: "datapour",
    name: "DataPour",
    tagline: "CSV / JSON / API data ingestion with schema validation.",
    category: "Data Pipelines",
    stack: ["Python", "Pandas"],
    hackathon: "Hack the North 2025",
    pricing: { model: "buy", amount: 650 },
    rating: 4.3,
    integrations: 21,
    complexity: "Medium",
    keywords: [
      "data",
      "ingest",
      "ingestion",
      "etl",
      "csv",
      "json",
      "import",
      "transform",
      "pipeline",
      "schema",
      "validation",
      "clean",
    ],
    inputs: "Data source (file or API endpoint), target schema.",
    outputs: "Cleaned dataset, validation report, rejected rows.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/datapour/ingest \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -F "file=@orders.csv" \\
  -F 'schema={
    "order_id": "string",
    "amount":   "number",
    "created":  "iso_datetime"
  }'`,
    fit: (proj, hits) => {
      if (hits.includes("csv")) {
        return `Handles your CSV ingestion and schema validation for ${proj}.`;
      }
      return `Powers the data ingestion and validation layer of ${proj}.`;
    },
  },
  {
    id: "sentinellog",
    name: "SentinelLog",
    tagline: "Error tracking and alerting with stack-trace deduplication.",
    category: "DevOps",
    stack: ["Go", "Redis"],
    hackathon: "HackMIT 2025",
    pricing: { model: "royalty", amount: 55 },
    rating: 4.9,
    integrations: 52,
    complexity: "Advanced",
    keywords: [
      "error",
      "errors",
      "tracking",
      "alert",
      "monitor",
      "monitoring",
      "log",
      "logging",
      "crash",
      "bug",
      "stack trace",
      "incident",
      "sentry",
    ],
    inputs: "Error events (message, stack trace, severity).",
    outputs: "Grouped reports, alert notifications, trend data.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/sentinellog/capture \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "TypeError: cannot read x of undefined",
    "stack":   "[…]",
    "severity": "error",
    "context": { "release": "v1.4.2" }
  }'`,
    fit: (proj) =>
      `Catches and groups errors in ${proj}, with alerting on regressions.`,
  },
  {
    id: "formcraft",
    name: "FormCraft",
    tagline: "Dynamic form builder with conditional logic and validation.",
    category: "UI Components",
    stack: ["React", "Zod"],
    hackathon: "TreeHacks 2025",
    pricing: { model: "buy", amount: 400 },
    rating: 4.4,
    integrations: 38,
    complexity: "Easy",
    keywords: [
      "form",
      "builder",
      "input",
      "field",
      "validation",
      "conditional",
      "survey",
      "dynamic",
      "custom",
    ],
    inputs: "Form schema (fields, rules, conditions).",
    outputs: "Validated data object, submission events.",
    snippet: `fetch('https://api.hackmarket.io/v1/formcraft/submit', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + HACKMARKET_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    form_id: 'contact_v2',
    values:  { name: 'Ada', email: 'ada@x.com' },
  }),
});`,
    fit: (proj, hits) => {
      if (hits.includes("custom fields") || hits.includes("form builder")) {
        return `Builds the custom form fields and validation for ${proj}.`;
      }
      return `Generates dynamic, validated forms inside ${proj}.`;
    },
  },
  {
    id: "vectorvault",
    name: "VectorVault",
    tagline: "Embeddings storage and similarity search.",
    category: "AI/ML",
    stack: ["Python", "FAISS"],
    hackathon: "CalHacks 2025",
    pricing: { model: "buy", amount: 1800 },
    rating: 4.7,
    integrations: 15,
    complexity: "Advanced",
    keywords: [
      "ai",
      "ml",
      "embedding",
      "embeddings",
      "vector",
      "vectors",
      "search",
      "similarity",
      "nlp",
      "rag",
      "semantic",
      "llm",
    ],
    inputs: "Text or vectors, collection name, query with top-k.",
    outputs: "Ranked results with similarity scores.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/vectorvault/search \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "collection": "docs",
    "query":      "how do refunds work",
    "top_k":      10
  }'`,
    fit: (proj) =>
      `Stores embeddings and powers similarity search in ${proj}.`,
  },
  {
    id: "cronpilot",
    name: "CronPilot",
    tagline: "Scheduled job runner with retry logic.",
    category: "DevOps",
    stack: ["Node.js", "Redis"],
    hackathon: "HackSC 2025",
    pricing: { model: "royalty", amount: 25 },
    rating: 4.2,
    integrations: 29,
    complexity: "Medium",
    keywords: [
      "cron",
      "schedule",
      "scheduled",
      "job",
      "timer",
      "recurring",
      "retry",
      "queue",
      "worker",
      "task",
      "background",
      "reminder",
      "reminders",
    ],
    inputs: "Cron expression, handler URL, retry policy.",
    outputs: "Execution logs, success/failure webhooks.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/cronpilot/schedule \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name":     "daily-rollup",
    "schedule": "0 3 * * *",
    "handler":  "https://api.yours.com/rollup",
    "retries":  3
  }'`,
    fit: (proj, hits) => {
      if (hits.includes("reminders") || hits.includes("reminder")) {
        return `Runs the scheduled reminders for ${proj}, with retries baked in.`;
      }
      return `Runs recurring background jobs for ${proj}.`;
    },
  },
  {
    id: "mailmerge",
    name: "MailMerge",
    tagline: "Transactional email templating and delivery.",
    category: "Notifications",
    stack: ["Python", "Jinja2"],
    hackathon: "Hack the North 2025",
    pricing: { model: "buy", amount: 350 },
    rating: 4.6,
    integrations: 71,
    complexity: "Easy",
    keywords: [
      "email",
      "transactional",
      "template",
      "templates",
      "mail",
      "delivery",
      "smtp",
      "newsletter",
      "drip",
      "campaign",
    ],
    inputs: "Template name, recipient, variables, attachments.",
    outputs: "Send confirmation, delivery status, open/click tracking.",
    snippet: `curl -X POST https://api.hackmarket.io/v1/mailmerge/send \\
  -H "Authorization: Bearer $HACKMARKET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "template":  "order_receipt",
    "to":        "customer@example.com",
    "vars":      { "total": "$24.00" }
  }'`,
    fit: (proj) =>
      `Sends transactional emails (receipts, alerts, drip) for ${proj}.`,
  },
];

// ─── Name matching (handles "auth forge" / "authforge" / "AuthForge") ────

function moduleNameVariants(m: KcModule): string[] {
  const compact = m.name.toLowerCase();
  const spaced = m.name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return Array.from(new Set([compact, spaced, m.id.toLowerCase()]));
}

function nameMatchInQuery(m: KcModule, lowerQuery: string): string | null {
  for (const v of moduleNameVariants(m)) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
    if (re.test(lowerQuery)) return v;
  }
  return null;
}

// ─── projectDescriptor: tries to extract "your X" from the search query ───

export function projectDescriptor(text: string): string {
  if (!text) return "your project";
  const t = text.toLowerCase().trim();
  const patterns = [
    /\bbuilding\s+(?:an?\s+)?([a-z][a-z\s\-/]{2,40}?)(?=\s+(?:with|that|to|for|and|using)\b|[.,]|$)/,
    /\b(?:i\s+have|i'm\s+making)\s+(?:an?\s+)?([a-z][a-z\s\-/]{2,40}?)(?=\s+(?:with|that|to|for|and|using)\b|[.,]|$)/,
    /\bfor\s+(?:my|a|an)\s+([a-z][a-z\s\-/]{2,40}?)(?=\s+(?:with|that|to|for|and|using)\b|[.,]|$)/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      const phrase = m[1].replace(/\s+(with|for|that|to|and|the|a|an)$/, "").trim();
      if (phrase.length > 2 && phrase.length < 60) return "your " + phrase;
    }
  }
  if (t.includes("saas")) return "your SaaS";
  if (t.includes("analytics dashboard")) return "your analytics dashboard";
  if (t.includes("dashboard")) return "your dashboard";
  if (t.includes("task manager") || t.includes("task management")) {
    return "your task manager";
  }
  if (t.includes("pipeline")) return "your pipeline";
  if (t.includes("app")) return "your app";
  if (t.includes("platform")) return "your platform";
  if (t.includes("tool")) return "your tool";
  return "your project";
}

export function fallbackFitLine(m: KcModule): string {
  const noun = CATEGORY_NOUN[m.category] ?? "module";
  return `Add ${noun} capabilities to your project.`;
}

// ─── matchModules: kc's scoring logic, lifted verbatim ──

export interface KcMatch {
  module: KcModule;
  score: number;
  hits: string[];
  fit: string;
  fallback?: boolean;
}

export function matchKcModules(query: string): KcMatch[] {
  const flatText = (query || "").toLowerCase().trim();
  if (!flatText) {
    // No query → show 3 most-integrated modules as discovery defaults.
    return [...KC_MODULES]
      .sort((a, b) => b.integrations - a.integrations)
      .slice(0, 3)
      .map((m) => ({
        module: m,
        score: 0,
        hits: [],
        fit: fallbackFitLine(m),
        fallback: true,
      }));
  }

  const project = projectDescriptor(flatText);

  const scored = KC_MODULES
    .map((m) => {
      let score = 0;
      const hits: string[] = [];

      // 1) Direct module-name mention dominates everything else.
      const named = nameMatchInQuery(m, flatText);
      if (named) {
        score += 50;
        hits.push(named);
      }

      // 2) Keyword matches.
      for (const kw of m.keywords) {
        if (flatText.includes(kw)) {
          score += kw.split(" ").length;
          hits.push(kw);
        }
      }

      const fit = hits.length > 0 ? m.fit(project, hits) : fallbackFitLine(m);
      return { module: m, score, hits, fit };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.module.integrations - a.module.integrations,
    );

  if (scored.length === 0) {
    return [...KC_MODULES]
      .sort((a, b) => b.integrations - a.integrations)
      .slice(0, 3)
      .map((m) => ({
        module: m,
        score: 0,
        hits: [],
        fit: fallbackFitLine(m),
        fallback: true,
      }));
  }

  return scored.slice(0, 8);
}

// ─── kcModuleToTool: shoehorn a KcModule into Hackmarket's Tool shape ────

const SELLER_STUB = {
  id: "00000000-0000-0000-0000-000000000000",
  display_name: "Rotshop Hackathon",
  avatar_url: null,
  username: "rotshop",
};

export function kcModuleToTool(m: KcModule): Tool {
  const isRoyalty = m.pricing.model === "royalty";
  return {
    id: `kc-${m.id}`,
    seller_id: SELLER_STUB.id,
    seller: SELLER_STUB,
    name: m.name,
    slug: m.id,
    tagline: m.tagline,
    description: `${m.tagline}\n\nWon at ${m.hackathon}. Built with ${m.stack.join(" + ")}.\n\nInputs: ${m.inputs}\nOutputs: ${m.outputs}`,
    category: KC_TO_TOOL_CATEGORY[m.category],
    status: "live",
    ownership_type: isRoyalty ? "royalty" : "full_sale",
    input_type: "json",
    output_type: "json",
    input_schema: { fields: [{ name: "input", type: "string", required: false }] },
    output_schema: { fields: [{ name: "result", type: "object" }] },
    price_per_request: isRoyalty ? (m.pricing.amount / 1000).toFixed(6) : null,
    one_time_price: !isRoyalty ? (m.pricing.amount).toFixed(2) : null,
    demo_url: null,
    api_endpoint: null,
    docker_image_uri: null,
    github_url: null,
    source_s3_key: null,
    config_s3_key: null,
    entry_command: null,
    port: 8080,
    processing_error: null,
    documentation: m.snippet,
    avg_response_time_ms: Math.round(80 + Math.random() * 80),
    total_requests: m.integrations,
    uptime_percentage: "99.9",
    is_featured: m.rating >= 4.7,
    view_count: m.integrations * 10,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}
