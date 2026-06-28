// Pure static server component — no "use client", no hooks, no
// IntersectionObserver. The CodeBlock import is a client component, but
// importing it from a server component is fine (Next handles the boundary).
// Sidebar is a plain list of anchor links — no active-section highlight.

import type { CSSProperties, ReactNode } from "react";

import CodeBlock from "@/components/docs/CodeBlock";

// ----------------------------------------------------------------------------
// Section registry – keep IDs in sync with anchor links so /docs#api-reference
// scrolls to the right place and the sidebar highlights correctly.
// ----------------------------------------------------------------------------

interface SidebarSection {
  id: string;
  label: string;
  children?: Array<{ id: string; label: string }>;
}

const SIDEBAR: SidebarSection[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    children: [
      { id: "what-is-hackmarket", label: "What is Hackmarket" },
      { id: "submission-flow", label: "Submission flow" },
      { id: "customer-flow", label: "Customer flow" },
    ],
  },
  {
    id: "api-reference",
    label: "API Reference",
    children: [
      { id: "base-url", label: "Base URL & auth" },
      { id: "gateway", label: "Gateway" },
      { id: "discovery", label: "Discovery" },
      { id: "submit", label: "Submit" },
      { id: "envelope", label: "Response envelope" },
      { id: "errors", label: "Errors" },
    ],
  },
  {
    id: "submitting",
    label: "Submitting Your Tool",
    children: [
      { id: "good-submission", label: "What makes a good submission" },
      { id: "lifecycle", label: "Review lifecycle" },
      { id: "io-contract", label: "I/O contract" },
      { id: "pricing", label: "Pricing models" },
    ],
  },
  {
    id: "guidelines",
    label: "Marketplace Guidelines",
    children: [
      { id: "rejection", label: "What gets rejected" },
      { id: "confidence", label: "High confidence score" },
      { id: "branding", label: "Branding rules" },
    ],
  },
  {
    id: "approver",
    label: "Approver Process",
    children: [
      { id: "human-review", label: "How review works" },
      { id: "timeline", label: "Timeline" },
      { id: "appeals", label: "Appeals" },
    ],
  },
  {
    id: "integration",
    label: "Integration Guide",
    children: [
      { id: "embedding", label: "Embedding a tool" },
      { id: "sdks", label: "SDKs" },
      { id: "request-ids", label: "Request IDs" },
    ],
  },
  {
    id: "faq",
    label: "FAQ",
  },
];

// Flatten section IDs for the IntersectionObserver. We track both top-level
// sections (h2) and child anchors (h3) so the sidebar highlights at both
// granularities.
const ALL_IDS: string[] = SIDEBAR.flatMap((s) =>
  s.children ? [s.id, ...s.children.map((c) => c.id)] : [s.id]
);

// ----------------------------------------------------------------------------
// Code samples – pre-built so the page renders fast and copy/paste works.
// ----------------------------------------------------------------------------

const gatewayExamples = [
  {
    language: "curl" as const,
    label: "cURL",
    code: `curl -X POST https://api.hackmarket.io/v1/tools/home-accessibility-checker \\
  -H "X-API-Key: hm_live_5a8c3e9b2d4f7a1c6e8b9d2f4a7c1e5b" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.zillow.com/homedetails/12-elm-street",
    "maxImages": 8
  }'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import requests

resp = requests.post(
    "https://api.hackmarket.io/v1/tools/home-accessibility-checker",
    headers={"X-API-Key": "hm_live_5a8c3e9b2d4f7a1c6e8b9d2f4a7c1e5b"},
    json={
        "url": "https://www.zillow.com/homedetails/12-elm-street",
        "maxImages": 8,
    },
    timeout=30,
)
resp.raise_for_status()
print(resp.json()["data"])`,
  },
  {
    language: "javascript" as const,
    label: "JavaScript",
    code: `const res = await fetch(
  "https://api.hackmarket.io/v1/tools/home-accessibility-checker",
  {
    method: "POST",
    headers: {
      "X-API-Key": "hm_live_5a8c3e9b2d4f7a1c6e8b9d2f4a7c1e5b",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: "https://www.zillow.com/homedetails/12-elm-street",
      maxImages: 8,
    }),
  }
);
const payload = await res.json();
console.log(payload.data);`,
  },
];

const discoveryExamples = [
  {
    language: "curl" as const,
    label: "cURL",
    code: `curl -X POST https://api.hackmarket.io/v1/tools/discover \\
  -H "X-API-Key: hm_live_5a8c3e9b2d4f7a1c6e8b9d2f4a7c1e5b" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "image background removal",
    "limit": 5,
    "filters": { "pricing_model": "royalty", "min_confidence": 0.8 }
  }'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import requests

resp = requests.post(
    "https://api.hackmarket.io/v1/tools/discover",
    headers={"X-API-Key": "hm_live_5a8c3e9b2d4f7a1c6e8b9d2f4a7c1e5b"},
    json={
        "query": "image background removal",
        "limit": 5,
        "filters": {"pricing_model": "royalty", "min_confidence": 0.8},
    },
)
for tool in resp.json()["data"]["tools"]:
    print(tool["slug"], tool["confidence"])`,
  },
];

const submitExamples = [
  {
    language: "curl" as const,
    label: "cURL",
    code: `curl -X POST https://api.hackmarket.io/v1/tools/submit \\
  -H "X-API-Key: hm_live_5a8c3e9b2d4f7a1c6e8b9d2f4a7c1e5b" \\
  -H "Content-Type: application/json" \\
  -d '{
    "repo_url": "https://github.com/aria-labs/alt-text-generator",
    "name": "Alt-Text Generator",
    "tagline": "Generate WCAG-compliant alt text from any image URL.",
    "pricing_model": "royalty",
    "price_per_call_cents": 4
  }'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import requests

resp = requests.post(
    "https://api.hackmarket.io/v1/tools/submit",
    headers={"X-API-Key": "hm_live_5a8c3e9b2d4f7a1c6e8b9d2f4a7c1e5b"},
    json={
        "repo_url": "https://github.com/aria-labs/alt-text-generator",
        "name": "Alt-Text Generator",
        "tagline": "Generate WCAG-compliant alt text from any image URL.",
        "pricing_model": "royalty",
        "price_per_call_cents": 4,
    },
)
print(resp.json()["data"]["submission_id"])`,
  },
];

const integrationExamples = [
  {
    language: "curl" as const,
    label: "cURL",
    code: `curl -X POST https://api.hackmarket.io/v1/tools/sentiment-classifier \\
  -H "X-API-Key: $HACKMARKET_KEY" \\
  -H "X-HackMarket-Request-Id: req_9f3d_write_2026_05_17_001" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Honestly the best burrito I have had this year."}'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import os, uuid, requests

def classify(text: str) -> dict:
    return requests.post(
        "https://api.hackmarket.io/v1/tools/sentiment-classifier",
        headers={
            "X-API-Key": os.environ["HACKMARKET_KEY"],
            "X-HackMarket-Request-Id": f"req_{uuid.uuid4().hex}",
        },
        json={"text": text},
        timeout=10,
    ).json()["data"]

print(classify("Honestly the best burrito I have had this year."))`,
  },
  {
    language: "javascript" as const,
    label: "JavaScript",
    code: `async function classify(text) {
  const res = await fetch(
    "https://api.hackmarket.io/v1/tools/sentiment-classifier",
    {
      method: "POST",
      headers: {
        "X-API-Key": process.env.HACKMARKET_KEY,
        "X-HackMarket-Request-Id": "req_" + crypto.randomUUID().replaceAll("-", ""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    }
  );
  if (!res.ok) throw new Error("hackmarket call failed");
  const { data } = await res.json();
  return data;
}`,
  },
];

// ----------------------------------------------------------------------------
// Tokens shared by inline styles. We hoist these so cards stay consistent.
// ----------------------------------------------------------------------------

const NAV_OFFSET = 88; // approximate height of the sticky site-nav + breathing room

const sectionContainer: CSSProperties = {
  scrollMarginTop: NAV_OFFSET,
  paddingBottom: 48,
  borderBottom: "1px solid var(--border)",
  marginBottom: 48,
};

const sectionHeading: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: 24,
  lineHeight: 1.2,
  color: "var(--text)",
  marginBottom: 6,
  scrollMarginTop: NAV_OFFSET,
  display: "flex",
  alignItems: "baseline",
  gap: 10,
};

const eyebrow: CSSProperties = {
  fontSize: 10.5,
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: ".14em",
  color: "var(--faint)",
  marginBottom: 8,
};

const subHeading: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 16,
  color: "var(--text)",
  marginTop: 28,
  marginBottom: 10,
  scrollMarginTop: NAV_OFFSET,
};

const bodyText: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 14.5,
  lineHeight: 1.75,
  color: "var(--muted)",
  marginBottom: 14,
};

const callout: CSSProperties = {
  background: "var(--elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "14px 16px",
  fontSize: 13.5,
  lineHeight: 1.65,
  color: "var(--muted)",
  marginBottom: 18,
};

const inlineCode: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  background: "var(--elevated)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "1px 6px",
  color: "var(--text)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13.5,
  marginBottom: 18,
  border: "1px solid var(--border)",
  borderRadius: 8,
  overflow: "hidden",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: ".1em",
  color: "var(--faint)",
  background: "var(--elevated)",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
};

const tdStyle: CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  verticalAlign: "top",
};

// ----------------------------------------------------------------------------
// Small primitives
// ----------------------------------------------------------------------------

function Code({ children }: { children: ReactNode }) {
  return <code style={inlineCode}>{children}</code>;
}

function JsonBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: "var(--elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 14,
        fontSize: 12.5,
        lineHeight: 1.6,
        color: "var(--text)",
        fontFamily: "var(--font-mono)",
        overflowX: "auto",
        marginBottom: 18,
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

function SectionHeader({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <header style={{ marginBottom: 18 }}>
      <p style={eyebrow}>{kicker}</p>
      <h2 id={id} style={sectionHeading}>
        <a
          href={`#${id}`}
          style={{ color: "inherit", textDecoration: "none" }}
          aria-label={`Permalink to ${title}`}
        >
          {title}
        </a>
      </h2>
    </header>
  );
}

function SubHeader({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} style={subHeading}>
      {children}
    </h3>
  );
}

function EndpointCard({
  method,
  path,
  description,
  examples,
}: {
  method: string;
  path: string;
  description: string;
  examples: { language: "curl" | "python" | "javascript" | "nodejs"; label: string; code: string }[];
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 18,
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            color: "var(--blue)",
            background: "var(--blue-dim)",
            padding: "3px 8px",
            borderRadius: 4,
            letterSpacing: ".08em",
          }}
        >
          {method}
        </span>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>
          {path}
        </code>
      </div>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--muted)", margin: 0 }}>
          {description}
        </p>
      </div>
      <div style={{ padding: 16 }}>
        <CodeBlock examples={examples} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sidebar with IntersectionObserver-driven active state.
// ----------------------------------------------------------------------------

function Sidebar() {
  return (
    <aside
      style={{
        position: "sticky",
        top: NAV_OFFSET - 12,
        alignSelf: "flex-start",
        width: 220,
        flexShrink: 0,
        maxHeight: `calc(100vh - ${NAV_OFFSET}px)`,
        overflowY: "auto",
        paddingRight: 12,
        paddingBottom: 24,
      }}
    >
      <p style={{ ...eyebrow, marginBottom: 14 }}>On this page</p>
      <nav>
        {SIDEBAR.map((section) => (
          <div key={section.id} style={{ marginBottom: 16 }}>
            <a
              href={`#${section.id}`}
              style={{
                display: "block",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: ".12em",
                fontWeight: 600,
                color: "var(--text)",
                borderLeft: "2px solid transparent",
                paddingLeft: 10,
                paddingTop: 4,
                paddingBottom: 4,
                textDecoration: "none",
              }}
            >
              {section.label}
            </a>
            {section.children && (
              <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0 0" }}>
                {section.children.map((child) => (
                  <li key={child.id}>
                    <a
                      href={`#${child.id}`}
                      style={{
                        display: "block",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: ".08em",
                        color: "var(--faint)",
                        borderLeft: "2px solid transparent",
                        paddingLeft: 18,
                        paddingTop: 4,
                        paddingBottom: 4,
                        textDecoration: "none",
                      }}
                    >
                      {child.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

const layoutStyle: CSSProperties = {
  display: "flex",
  gap: 56,
  alignItems: "flex-start",
  maxWidth: 1120,
  margin: "0 auto",
  padding: "32px 24px 80px",
};

export default function DocsContent() {
  return (
    <main style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>
      <div style={layoutStyle} className="docs-shell">
        <Sidebar />

        <article style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
          <div style={{ marginBottom: 40 }}>
            <p style={eyebrow}>Hackmarket Documentation</p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1.1,
                color: "var(--text)",
                marginBottom: 12,
              }}
            >
              Build, list, and integrate AI tools.
            </h1>
            <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "var(--muted)", margin: 0 }}>
              Everything you need to know to submit a tool to the marketplace or integrate one into
              your product. Real endpoints, real examples, no fluff.
            </p>
          </div>

          {/* ============================================================ */}
          {/* 1. GETTING STARTED                                            */}
          {/* ============================================================ */}
          <section id="getting-started" style={sectionContainer}>
            <SectionHeader id="getting-started" kicker="01 — Overview" title="Getting Started" />

            <SubHeader id="what-is-hackmarket">What Hackmarket is</SubHeader>
            <p style={bodyText}>
              Hackmarket is a marketplace for AI-powered developer tools. Builders submit a GitHub
              repository, Hackmarket takes care of containerization, gateway routing, billing, and
              observability, and the tool starts earning revenue per API call the moment it goes
              live. Every tool in the catalog speaks the same authentication, error, and metering
              protocol — so consumers can swap one tool for another without rewriting client code,
              and producers can ship without standing up their own billing stack.
            </p>
            <p style={bodyText}>
              The platform was built around a simple observation: most hackathon projects die on
              GitHub. A working demo, a polished README, and then nothing. Hackmarket turns that
              dead code into a revenue-bearing API in under 24 hours — without forcing the author to
              maintain infrastructure they did not sign up for.
            </p>

            <SubHeader id="submission-flow">The submission flow</SubHeader>
            <p style={bodyText}>
              Submitting a tool takes four steps. First, you paste a public GitHub URL into the
              submit form and pick a pricing model. Second, Hackmarket clones the repo, parses the
              manifest, and runs an automated test battery — the AI agent reads your README,
              infers the API surface, generates a fixture set, and grades the tool on correctness,
              latency, and error handling. Third, a human reviewer reads the auto-generated Quality
              Report and either approves the listing or returns it with written feedback. Finally,
              once approved, your tool is live: it gets a slug at{" "}
              <Code>api.hackmarket.io/v1/tools/&lt;slug&gt;</Code>, a public landing page, and a
              real-time analytics dashboard. The median time from submit to live listing is under
              24 hours.
            </p>

            <SubHeader id="customer-flow">The customer flow</SubHeader>
            <p style={bodyText}>
              Consumers discover tools through the marketplace search or the discovery API. Each
              listing has a live, interactive demo so you can try the tool before committing —
              paste a real input, see a real response. Generate an API key from your dashboard,
              add it to your client as an <Code>X-API-Key</Code> header, and start making calls.
              Billing is metered per request, surfaced in your usage tab in near real time, and
              invoiced on the first of every month. There is no SDK install, no Docker image to
              pull, no infra to manage — just HTTP.
            </p>
          </section>

          {/* ============================================================ */}
          {/* 2. API REFERENCE                                              */}
          {/* ============================================================ */}
          <section id="api-reference" style={sectionContainer}>
            <SectionHeader id="api-reference" kicker="02 — Reference" title="API Reference" />

            <SubHeader id="base-url">Base URL &amp; authentication</SubHeader>
            <p style={bodyText}>
              All API traffic flows through a single base URL:{" "}
              <Code>https://api.hackmarket.io/v1</Code>. Every request must carry your API key in
              the <Code>X-API-Key</Code> header. Keys are environment-scoped — keep your{" "}
              <Code>hm_live_*</Code> key on the server and use a separate <Code>hm_test_*</Code>{" "}
              key for local development. Rotating a key invalidates the previous value immediately;
              there is no grace window, so update your secrets manager before regenerating in
              production.
            </p>
            <div style={callout}>
              <strong style={{ color: "var(--text)" }}>Heads up.</strong> Hackmarket never accepts
              keys in query strings. If you find yourself appending <Code>?api_key=...</Code> to a
              URL, stop — the gateway will reject the request with a 401 and log the key as
              compromised. Use the header.
            </div>

            <SubHeader id="gateway">Gateway — invoke a tool</SubHeader>
            <p style={bodyText}>
              The gateway endpoint proxies your request through to the underlying tool, applying
              authentication, rate limiting, metering, and a uniform response envelope along the
              way. The HTTP method is whatever the tool defines — most accept <Code>POST</Code>,
              some <Code>GET</Code>. The request body is passed through verbatim, so the tool sees
              exactly the JSON you sent.
            </p>
            <EndpointCard
              method="ANY"
              path="/v1/tools/{slug}"
              description="Invoke a published tool. The slug is the unique identifier shown on the listing page. The gateway forwards your body, returns the tool's response wrapped in the standard envelope, and records the call against your usage meter."
              examples={gatewayExamples}
            />
            <p style={{ ...bodyText, marginBottom: 8 }}>Sample response:</p>
            <JsonBlock>{`{
  "success": true,
  "data": {
    "score": 72,
    "issues": [
      { "severity": "high", "title": "Front entrance has 3 steps, no ramp visible" },
      { "severity": "medium", "title": "Bathroom door appears narrower than 32 inches" }
    ],
    "evaluated_images": 8
  },
  "module": "home-accessibility-checker",
  "version": "1.4.2",
  "request_id": "req_01HZ4G9N7Y3K2VX8C1B5W6D2QH"
}`}</JsonBlock>

            <SubHeader id="discovery">Discovery — search the catalog</SubHeader>
            <p style={bodyText}>
              Discovery is a semantic search endpoint that returns matching tools ranked by
              embedding similarity to your query. Useful when you want to build a meta-agent that
              picks tools at runtime rather than hard-coding slugs.
            </p>
            <EndpointCard
              method="POST"
              path="/v1/tools/discover"
              description="Semantic search across the marketplace. Returns up to 25 tools matching the query, with relevance scores, pricing, and the AI confidence rating. Supports filters by pricing model, language, and minimum confidence."
              examples={discoveryExamples}
            />
            <JsonBlock>{`{
  "success": true,
  "data": {
    "tools": [
      {
        "slug": "remove-bg-pro",
        "name": "RemoveBG Pro",
        "tagline": "One-shot background removal for product photos.",
        "pricing_model": "royalty",
        "price_per_call_cents": 3,
        "confidence": 0.91,
        "relevance": 0.88,
        "p95_latency_ms": 142
      }
    ],
    "total": 1
  },
  "module": "discovery",
  "version": "2.0.0",
  "request_id": "req_01HZ4GBC4D1Y5N3M7P0K2X9R8L"
}`}</JsonBlock>

            <SubHeader id="submit">Submit — list a new tool</SubHeader>
            <p style={bodyText}>
              Submit accepts a GitHub repository URL plus listing metadata and kicks off the
              review pipeline. The response includes a <Code>submission_id</Code> you can poll for
              status, or wire to a webhook so the platform pings you when the state changes.
            </p>
            <EndpointCard
              method="POST"
              path="/v1/tools/submit"
              description="Create a new submission. The repo must be public or have a hackmarket-bot deploy key. Hackmarket reads the README and manifest, clones at the latest commit on the default branch, and queues the AI test agent."
              examples={submitExamples}
            />
            <JsonBlock>{`{
  "success": true,
  "data": {
    "submission_id": "sub_01HZ4GD9XK6Q4N2H7P1Y3X8W2K",
    "status": "submitted",
    "next_stage": "ai_testing",
    "estimated_review_at": "2026-05-18T03:00:00Z"
  },
  "module": "submissions",
  "version": "1.2.0",
  "request_id": "req_01HZ4GD9XK6Q4N2H7P1Y3X8W2K"
}`}</JsonBlock>

            <SubHeader id="envelope">Response envelope</SubHeader>
            <p style={bodyText}>
              Every successful response is wrapped in a consistent envelope. The <Code>data</Code>{" "}
              field carries the tool-specific payload; the metadata fields below it are added by
              the gateway and are identical across endpoints.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Field</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>
                    <Code>success</Code>
                  </td>
                  <td style={tdStyle}>boolean</td>
                  <td style={tdStyle}>True on 2xx; absent on 4xx/5xx (see error format below).</td>
                </tr>
                <tr>
                  <td style={tdStyle}>
                    <Code>data</Code>
                  </td>
                  <td style={tdStyle}>object | array</td>
                  <td style={tdStyle}>Tool-defined payload. Schema lives on the listing page.</td>
                </tr>
                <tr>
                  <td style={tdStyle}>
                    <Code>module</Code>
                  </td>
                  <td style={tdStyle}>string</td>
                  <td style={tdStyle}>Slug of the tool that handled the request.</td>
                </tr>
                <tr>
                  <td style={tdStyle}>
                    <Code>version</Code>
                  </td>
                  <td style={tdStyle}>string</td>
                  <td style={tdStyle}>Semver of the build that served the response.</td>
                </tr>
                <tr>
                  <td style={tdStyle}>
                    <Code>request_id</Code>
                  </td>
                  <td style={tdStyle}>string</td>
                  <td style={tdStyle}>ULID. Echo this in support tickets so we can trace.</td>
                </tr>
              </tbody>
            </table>

            <SubHeader id="errors">Errors</SubHeader>
            <p style={bodyText}>
              Errors come back as JSON with an HTTP status that matches the error severity. The
              shape is consistent regardless of which underlying tool failed — your client only
              needs one error handler.
            </p>
            <JsonBlock>{`{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded: 100 requests/minute on plan free.",
    "status": 429,
    "request_id": "req_01HZ4GF0Q1Y8N3X7K2P5W6D9R3",
    "details": {
      "limit": 100,
      "window": "60s",
      "retry_after_ms": 18500
    }
  }
}`}</JsonBlock>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>What it means</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>401</td>
                  <td style={tdStyle}>
                    <Code>invalid_key</Code>
                  </td>
                  <td style={tdStyle}>
                    Key missing, malformed, revoked, or sent in the wrong environment.
                  </td>
                </tr>
                <tr>
                  <td style={tdStyle}>429</td>
                  <td style={tdStyle}>
                    <Code>rate_limited</Code>
                  </td>
                  <td style={tdStyle}>
                    You exceeded your plan&apos;s requests/minute. Check{" "}
                    <Code>retry_after_ms</Code> before retrying.
                  </td>
                </tr>
                <tr>
                  <td style={tdStyle}>502</td>
                  <td style={tdStyle}>
                    <Code>tool_unavailable</Code>
                  </td>
                  <td style={tdStyle}>
                    The upstream tool is deployed but not responding. Hackmarket retries twice
                    before surfacing this.
                  </td>
                </tr>
                <tr>
                  <td style={tdStyle}>504</td>
                  <td style={tdStyle}>
                    <Code>tool_timeout</Code>
                  </td>
                  <td style={tdStyle}>
                    Tool exceeded its declared timeout (default 30s). Consider an async pattern if
                    you hit this.
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* ============================================================ */}
          {/* 3. SUBMITTING                                                 */}
          {/* ============================================================ */}
          <section id="submitting" style={sectionContainer}>
            <SectionHeader
              id="submitting"
              kicker="03 — For builders"
              title="Submitting Your Tool"
            />

            <SubHeader id="good-submission">What makes a good submission</SubHeader>
            <p style={bodyText}>
              The AI testing agent is good but not psychic. The more your repo looks like a real
              piece of infrastructure, the higher your confidence score and the faster human
              review will go. Four things matter most: a README that explains setup and lists
              every endpoint with at least one example request/response pair; a manifest file (
              <Code>package.json</Code>, <Code>pyproject.toml</Code>, <Code>go.mod</Code>, etc.)
              that declares your runtime and dependencies cleanly; environment-variable-driven
              configuration so the build container can inject keys without touching your code; and
              a non-trivial test suite — even five integration tests catch the obvious regressions
              the AI agent will otherwise re-discover on every submission.
            </p>
            <p style={bodyText}>
              Tools that ship with a <Code>Dockerfile</Code> and a <Code>hackmarket.yaml</Code>{" "}
              manifest skip several review steps because Hackmarket can build them as-is. Tools
              that rely on the auto-detected default Dockerfile usually work, but you give up
              control over the runtime — pin a base image if you care.
            </p>

            <SubHeader id="lifecycle">The four-stage lifecycle</SubHeader>
            <p style={bodyText}>
              Every submission moves through four states. <strong>Submitted</strong> is the
              initial state: your record exists, the queue knows about you, nothing has run yet.
              Expect this to last seconds.
            </p>
            <p style={bodyText}>
              <strong>AI Testing</strong> kicks in next. The agent clones the repo, reads the
              README, generates a test plan, fires synthetic requests, and produces a quality
              report covering correctness, latency, error handling, and security posture. This
              typically takes 5–20 minutes depending on tool complexity. You can watch progress
              live from the submission detail page.
            </p>
            <p style={bodyText}>
              <strong>Manual Review</strong> is where a human takes over. A reviewer reads the AI
              report, runs the live demo, sanity-checks the README, and decides. They will leave a
              public note either way — approved tools get a note that becomes part of the listing,
              rejected tools get actionable feedback.
            </p>
            <p style={bodyText}>
              <strong>Listed</strong> means you are live. The gateway slug is active, the listing
              page is public, and consumers can call your tool. Updates after listing re-trigger
              AI testing but skip the manual review queue unless something regresses.
            </p>

            <SubHeader id="io-contract">The I/O contract</SubHeader>
            <p style={bodyText}>
              The AI confidence score weighs heavily on how well your declared I/O contract
              matches what the tool actually does. In your manifest, the <Code>inputs</Code>{" "}
              section should describe every field the tool accepts: name, type, whether it is
              required, default value, and a one-line description. The <Code>outputs</Code>{" "}
              section should describe the response payload with the same level of specificity.
              The AI agent uses these to generate test fixtures; mismatches between declared and
              observed behavior are the single biggest reason scores land under 80.
            </p>
            <p style={bodyText}>
              Concretely: if you declare <Code>maxImages</Code> as an integer between 1 and 16
              with a default of 8, the agent will test the boundaries (1, 8, 16) and verify your
              tool either accepts them or returns a clean 400. If it crashes at 16, your score
              drops. If it silently truncates at 5 without telling the caller, your score drops
              further. Be precise in the manifest and your tool will look good against it.
            </p>

            <SubHeader id="pricing">Pricing models</SubHeader>
            <p style={bodyText}>
              Hackmarket supports two pricing models. <Code>buy</Code> is a one-time license: the
              buyer pays a fixed price and gets unlimited use plus the source artifact. This fits
              components and libraries — UI kits, design systems, code generators that produce
              static output. <Code>royalty</Code> is per-call: the buyer pays a few cents per
              request, you get the bulk of it (Hackmarket takes a 15% platform fee). This fits
              APIs and live infrastructure — classifiers, generators, transformers that need to
              run for each call.
            </p>
            <p style={bodyText}>
              You can switch pricing models post-launch, but it triggers a re-review because the
              contract with existing buyers changes. Set a model you can live with for at least 90
              days.
            </p>
          </section>

          {/* ============================================================ */}
          {/* 4. MARKETPLACE GUIDELINES                                     */}
          {/* ============================================================ */}
          <section id="guidelines" style={sectionContainer}>
            <SectionHeader
              id="guidelines"
              kicker="04 — Policy"
              title="Marketplace Guidelines"
            />

            <SubHeader id="rejection">What gets rejected</SubHeader>
            <p style={bodyText}>
              The reviewer queue rejects submissions for five common reasons. <strong>Malicious
              code</strong> — anything that exfiltrates data, mines crypto, calls home to
              unrelated servers, or executes obfuscated payloads — is an instant ban, not just a
              rejection. <strong>Duplicates</strong> of existing tools get rejected unless you can
              demonstrate a meaningful difference (better accuracy, lower latency, different
              license). Forking an existing listing and changing the README is not enough.
            </p>
            <p style={bodyText}>
              <strong>Broken or untested code</strong> that fails the AI test battery without a
              plausible explanation gets rejected with feedback. <strong>Terms-of-service
              violations</strong> — using third-party content, models, or APIs without
              authorization — are rejected and, in repeat cases, the account is suspended.
              Finally, <strong>thin proxies</strong> to upstream APIs you do not own get rejected:
              if your tool is a 20-line wrapper around an OpenAI endpoint, Hackmarket is not the
              right home. Add genuine value (fine-tuning, post-processing, a novel data pipeline)
              or list elsewhere.
            </p>

            <SubHeader id="confidence">What earns a high confidence score</SubHeader>
            <p style={bodyText}>
              The AI confidence score caps at 1.0 and is computed from five inputs. To land in the
              80+ tier — which is roughly the cutoff for being featured — you need: endpoints
              that conform to the declared I/O contract on the boundary cases the agent
              generates; <strong>p95 latency under 200ms</strong> for synchronous tools, measured
              from the gateway inbound to the gateway outbound, on a warm path; no critical CVEs
              in your dependency tree on the date of submission (run <Code>npm audit</Code> or{" "}
              <Code>pip-audit</Code> before submitting); consistent error responses that return
              proper HTTP status codes with structured bodies — not a 200 with{" "}
              <Code>{`{"error": "..."}`}</Code> inside; and basic REST hygiene — verbs match
              methods, idempotent operations are idempotent, query parameters do what their names
              imply.
            </p>

            <SubHeader id="branding">Branding rules</SubHeader>
            <p style={bodyText}>
              Use your own name, your own tagline, and your own brand. Tools that impersonate
              other companies — naming themselves &quot;Stripe Refunds&quot; or &quot;OpenAI
              Whisper Plus&quot; — are rejected on first submission and the namespace is reserved.
              You can describe what your tool does (&quot;a Stripe webhook handler&quot;) but you
              cannot present yourself as that company or use their trademarks in your name or
              logo. When in doubt, ask before submitting; Hackmarket support replies within a
              business day.
            </p>
          </section>

          {/* ============================================================ */}
          {/* 5. APPROVER PROCESS                                           */}
          {/* ============================================================ */}
          <section id="approver" style={sectionContainer}>
            <SectionHeader id="approver" kicker="05 — Review" title="Approver Process" />

            <SubHeader id="human-review">How human review works</SubHeader>
            <p style={bodyText}>
              Every submission that passes AI testing lands in a queue ordered by submission time.
              A reviewer opens the submission detail page, reads the auto-generated AI Quality
              Report (correctness, latency, error handling, security findings, declared vs.
              observed behavior), and runs the live demo themselves — clicking through the same
              embedded UI a customer would see. They are looking for the things AI testing cannot
              easily catch: deceptive marketing copy, broken demo flows, low-effort or copy-pasted
              listings, and outputs that look right but are subtly wrong.
            </p>
            <p style={bodyText}>
              If everything checks out, the reviewer clicks Approve and the listing goes live
              within minutes — DNS for the slug propagates, the public page becomes visible, and
              the tool starts accepting traffic. If something is wrong, the reviewer clicks
              Reject and writes a note explaining what to fix. That note is private to the
              submitter and stays attached to the submission so future reviewers can see the
              history.
            </p>

            <SubHeader id="timeline">Timeline</SubHeader>
            <p style={bodyText}>
              The median time from submit to listed is under 24 hours, with most submissions
              clearing in 6–12. AI testing accounts for 5–20 minutes; the rest is queue depth on
              the human reviewer side. Submissions filed Friday evening typically clear Monday
              morning — that is the worst case. Priority review (within 4 hours) is available on
              the Pro tier for builders who need to ship on a deadline.
            </p>

            <SubHeader id="appeals">Appeals</SubHeader>
            <p style={bodyText}>
              If your submission is rejected, you can address the feedback and resubmit the same
              repository — no need to create a new submission. The AI testing history is preserved
              across attempts so the reviewer can see your progress. If you believe a rejection
              was incorrect, reply to the reviewer&apos;s note inside the submission detail page;
              a second reviewer will take a fresh look. Repeat appeals on the same submission
              after a second rejection require a Pro-tier subscription.
            </p>
          </section>

          {/* ============================================================ */}
          {/* 6. INTEGRATION GUIDE                                          */}
          {/* ============================================================ */}
          <section id="integration" style={sectionContainer}>
            <SectionHeader
              id="integration"
              kicker="06 — For consumers"
              title="Integration Guide"
            />

            <SubHeader id="embedding">Embedding a Hackmarket tool</SubHeader>
            <p style={bodyText}>
              Calling a Hackmarket tool from your application is the same as calling any HTTP
              JSON API. Pick the slug from the listing page, set <Code>X-API-Key</Code>, send the
              body the tool expects, and parse the response. Three short examples below — pick
              your language and copy.
            </p>
            <EndpointCard
              method="POST"
              path="/v1/tools/sentiment-classifier"
              description="A representative integration: classify a string as positive / neutral / negative. Pass X-HackMarket-Request-Id so your logs, gateway responses, and support tickets line up across the platform."
              examples={integrationExamples}
            />

            <SubHeader id="sdks">SDKs</SubHeader>
            <p style={bodyText}>
              Official SDKs for TypeScript, Python, Go, and Ruby are on the roadmap and tracked
              publicly on the GitHub status page. For now, the recommendation is the same
              regardless of language: call the REST endpoints directly. Hackmarket&apos;s API is
              intentionally narrow — three endpoint groups, one auth header, one envelope — so a
              hand-rolled wrapper is usually 20 lines and easier to maintain than a generated
              client.
            </p>

            <SubHeader id="request-ids">Request IDs</SubHeader>
            <p style={bodyText}>
              Send <Code>X-HackMarket-Request-Id</Code> with a stable, URL-safe value when you call
              a tool. Hackmarket echoes it in API responses, forwards it to seller tools, and
              includes it in logs and alerts so buyer support, seller debugging, and platform
              operations can trace the same request. It is a tracing key, not an idempotency key:
              if your client retries a mutating tool call, make sure that tool&apos;s own API is safe
              to retry before sending the request again.
            </p>
          </section>

          {/* ============================================================ */}
          {/* 7. FAQ                                                        */}
          {/* ============================================================ */}
          <section
            id="faq"
            style={{ ...sectionContainer, borderBottom: "none", marginBottom: 0 }}
          >
            <SectionHeader id="faq" kicker="07 — Common questions" title="FAQ" />

            <FaqItem question="How fast does my tool need to respond?">
              For high-tier listings (featured placement, discovery boost, the &quot;Verified
              Fast&quot; badge) the gateway requires p95 latency under 200ms on a warm path. For
              general listings, the cap is 500ms p95. Tools that consistently exceed 30 seconds
              get downgraded to async — the gateway returns a job ID immediately and the client
              polls or waits for a webhook. You can opt into async explicitly in your manifest if
              your work is naturally long-running.
            </FaqItem>

            <FaqItem question="Do I keep ownership of my code?">
              Yes. Hackmarket hosts a build artifact from your GitHub repository, not the source
              itself. You retain copyright and all IP rights. You can revoke the listing at any
              time and the artifact is destroyed within 24 hours. The marketplace agreement is
              non-exclusive — list the same tool elsewhere if you want, run your own hosted
              version in parallel, anything you like.
            </FaqItem>

            <FaqItem question="How do I get paid?">
              Per-call royalties are aggregated in real time, totaled weekly, and paid out
              monthly via Stripe Connect. The first payout requires a one-time Stripe onboarding
              flow (tax info, bank details, identity verification) — about 10 minutes. After
              that, payouts are automatic on the 1st of every month for the previous month&apos;s
              earnings. The minimum payout threshold is $10; balances under that roll forward.
            </FaqItem>

            <FaqItem question="What if my tool depends on a third-party API?">
              That is fine as long as you have authorized access to it. You must disclose the
              dependency in your listing — the &quot;Powered by&quot; field on the tool page — so
              consumers know about the chain. Tools that secretly proxy to a paid third-party
              API the author does not have rights to are rejected and the account is flagged.
              Pricing should reflect the upstream cost; Hackmarket does not subsidize your
              margin.
            </FaqItem>

            <FaqItem question="Can I update my tool after listing?">
              Yes. Push a new commit to the default branch and re-submit the same repo from your
              dashboard. AI testing reruns automatically. If the update changes the public I/O
              contract — different fields, different status codes, different output shape — it
              triggers a fresh human review because consumers may need to update their clients.
              Patch-level updates (bug fixes, performance work) skip human review and go live
              within minutes of passing AI testing.
            </FaqItem>

            <FaqItem question="What languages and runtimes are supported?">
              Anything that exposes an HTTP server on a port Hackmarket can probe. Node, Python,
              Go, Rust, Ruby, Java, .NET, PHP, Elixir — all supported out of the box. If your
              tool ships a <Code>Dockerfile</Code>, Hackmarket builds it as-is. If not, the
              auto-build detects common runtimes from the manifest and produces a sensible
              default. Static binaries work too; just declare the entrypoint in{" "}
              <Code>hackmarket.yaml</Code>.
            </FaqItem>

            <FaqItem question="Is there a free tier for testing?">
              Yes. Every account gets 1,000 free gateway calls per month and unlimited free
              discovery and submit calls. That is enough to develop and demo against, and it does
              not require a credit card on file. Past the free tier, calls are billed at the
              listed per-call price for each tool. Spending caps and email alerts can be
              configured in your billing settings.
            </FaqItem>
          </section>
        </article>
      </div>

      {/* Mobile: stack sidebar above content. Inline CSS via styled-jsx-free approach. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media (max-width: 900px) {
          .docs-shell {
            flex-direction: column !important;
            gap: 24px !important;
          }
          .docs-shell > aside {
            position: static !important;
            width: 100% !important;
            max-height: none !important;
            overflow-y: visible !important;
            padding-right: 0 !important;
          }
          .docs-shell > article {
            max-width: 100% !important;
          }
        }
      `,
        }}
      />
    </main>
  );
}

// ----------------------------------------------------------------------------
// FAQ item — small accordion-free card so all answers stay scannable on load.
// ----------------------------------------------------------------------------

function FaqItem({ question, children }: { question: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "16px 18px",
        marginBottom: 12,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: 15,
          color: "var(--text)",
          marginBottom: 8,
        }}
      >
        {question}
      </p>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--muted)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
