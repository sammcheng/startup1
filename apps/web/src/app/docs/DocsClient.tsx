// Pure static server component — no "use client", no hooks, no
// IntersectionObserver. The CodeBlock import is a client component, but
// importing it from a server component is fine (Next handles the boundary).
// Sidebar is a plain list of anchor links — no active-section highlight.

import type { CSSProperties, ReactNode } from "react";

import CodeBlock from "@/components/docs/CodeBlock";
import { API_BASE, getGatewayBaseUrl } from "@/lib/env";

const DOCS_API_BASE = API_BASE.replace(/\/+$/, "");
const DOCS_GATEWAY_BASE = getGatewayBaseUrl().replace(/\/+$/, "");

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
      { id: "envelope", label: "Gateway response" },
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
    code: `curl -X POST ${DOCS_GATEWAY_BASE}/tools/home-accessibility-checker \\
  -H "X-API-Key: $HACKMARKET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.zillow.com/homedetails/12-elm-street",
    "maxImages": 8
  }'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import os
import requests

resp = requests.post(
    "${DOCS_GATEWAY_BASE}/tools/home-accessibility-checker",
    headers={"X-API-Key": os.environ["HACKMARKET_API_KEY"]},
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
  "${DOCS_GATEWAY_BASE}/tools/home-accessibility-checker",
  {
    method: "POST",
    headers: {
      "X-API-Key": process.env.HACKMARKET_API_KEY,
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
    code: `curl -X POST ${DOCS_API_BASE}/tools/discover \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "image background removal",
    "limit": 5,
    "categories": ["computer_vision"]
  }'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import requests

resp = requests.post(
    "${DOCS_API_BASE}/tools/discover",
    json={
        "query": "image background removal",
        "limit": 5,
        "categories": ["computer_vision"],
    },
)
for match in resp.json()["matches"]:
    print(match["tool"]["slug"], match["match_score"])`,
  },
];

const submitExamples = [
  {
    language: "curl" as const,
    label: "cURL",
    code: `curl -X POST ${DOCS_API_BASE}/tools/submit \\
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "github_url": "https://github.com/aria-labs/alt-text-generator"
  }'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import os
import requests

resp = requests.post(
    "${DOCS_API_BASE}/tools/submit",
    headers={"Authorization": f"Bearer {os.environ['CLERK_SESSION_TOKEN']}"},
    json={
        "github_url": "https://github.com/aria-labs/alt-text-generator",
    },
)
resp.raise_for_status()
print(resp.json()["tool"]["id"])`,
  },
];

const integrationExamples = [
  {
    language: "curl" as const,
    label: "cURL",
    code: `curl -X POST ${DOCS_GATEWAY_BASE}/tools/sentiment-classifier \\
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
        "${DOCS_GATEWAY_BASE}/tools/sentiment-classifier",
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
    "${DOCS_GATEWAY_BASE}/tools/sentiment-classifier",
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
              once approved, your tool is live at{" "}
              <Code>{`${DOCS_GATEWAY_BASE}/tools/<slug>`}</Code>, with a public listing and an
              account-owned analytics dashboard. The seller dashboard shows the actual processing
              state throughout the flow, including queued, running, retrying, failed, and completed
              jobs.
            </p>

            <SubHeader id="customer-flow">The customer flow</SubHeader>
            <p style={bodyText}>
              Consumers discover tools through the marketplace search or the discovery API. Each
              listing has a live, interactive demo so you can try the tool before committing —
              paste a real input, see a real response. Generate an API key from your dashboard,
              add it to your client as an <Code>X-API-Key</Code> header, and start making calls.
              Billing is metered per request, surfaced in your dashboard, and aggregated into
              weekly usage invoices. There is no SDK install, no Docker image to
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
              Catalog and account endpoints use <Code>{DOCS_API_BASE}</Code>. Published tool calls
              use <Code>{DOCS_GATEWAY_BASE}</Code> and require an account API key in the{" "}
              <Code>X-API-Key</Code> header. Keep each <Code>hm_live_*</Code> key in a server-side
              secrets manager. Seller submission endpoints use the signed-in Clerk session instead
              of a buyer API key.
            </p>
            <div style={callout}>
              <strong style={{ color: "var(--text)" }}>Heads up.</strong> Hackmarket never accepts
              keys in query strings. If you find yourself appending <Code>?api_key=...</Code> to a
              URL, stop — the gateway only authenticates the <Code>X-API-Key</Code> header.
            </div>

            <SubHeader id="gateway">Gateway — invoke a tool</SubHeader>
            <p style={bodyText}>
              The gateway endpoint proxies your request through to the underlying tool, applying
              authentication, rate limiting, metering, and platform error handling along the way.
              The HTTP method is whatever the tool defines — most accept <Code>POST</Code>,
              some <Code>GET</Code>. The request body is passed through verbatim, so the tool sees
              exactly the JSON you sent. Successful response bodies are passed through unchanged;
              request IDs, timing, and rate-limit details are returned as response headers.
            </p>
            <EndpointCard
              method="ANY"
              path="/api/v1/tools/{slug}"
              description="Invoke a published tool. The slug is the unique identifier shown on the listing page. The gateway forwards your request, returns the tool's response, and records the call against your usage meter."
              examples={gatewayExamples}
            />
            <p style={{ ...bodyText, marginBottom: 8 }}>Sample response:</p>
            <JsonBlock>{`{
  "success": true,
  "analysis": {
    "overall_score": 72,
    "analyzed_images": 8,
    "accessibility_features": ["Step-free side entrance"],
    "barriers": ["Front entrance has steps and no visible ramp"],
    "recommendations": ["Confirm an accessible entrance before visiting"]
  }
}`}</JsonBlock>

            <SubHeader id="discovery">Discovery — search the catalog</SubHeader>
            <p style={bodyText}>
              Discovery tokenizes a natural-language query and ranks live tools using their name,
              tagline, description, category, and declared schemas. It is useful when a client
              needs to select from the current catalog instead of hard-coding a slug.
            </p>
            <EndpointCard
              method="POST"
              path="/v1/tools/discover"
              description="Search the live marketplace. Returns up to 24 ranked matches and supports an optional list of marketplace categories."
              examples={discoveryExamples}
            />
            <JsonBlock>{`{
  "matches": [
    {
      "tool": {
        "slug": "remove-bg-pro",
        "name": "RemoveBG Pro",
        "tagline": "One-shot background removal for product photos.",
        "category": "computer_vision",
        "price_per_request": "0.030000"
      },
      "fit_line": "Matches image background removal",
      "match_score": 0.88,
      "matched_keywords": ["image", "background", "removal"],
      "source": "verified"
    }
  ],
  "query": "image background removal"
}`}</JsonBlock>

            <SubHeader id="submit">Submit — list a new tool</SubHeader>
            <p style={bodyText}>
              Submit accepts a public GitHub repository URL from a signed-in seller. Hackmarket
              analyzes the repository and returns the account-owned draft plus the extracted
              listing fields. The seller can review those fields before configuring and queuing the
              deployment job.
            </p>
            <EndpointCard
              method="POST"
              path="/v1/tools/submit"
              description="Analyze a public GitHub repository and create a draft owned by the signed-in seller. Production requests require a valid Clerk session token."
              examples={submitExamples}
            />
            <JsonBlock>{`{
  "tool": {
    "id": "b9988663-e8e5-4d60-8773-c40d9d71bd24",
    "name": "Alt-Text Generator",
    "slug": "alt-text-generator",
    "status": "draft"
  },
  "analysis": {
    "name": "Alt-Text Generator",
    "category": "generation",
    "tech_stack": ["Python", "FastAPI"],
    "pricing_model": "royalty"
  },
  "message": "Repository analyzed and draft created."
}`}</JsonBlock>

            <SubHeader id="envelope">Gateway response</SubHeader>
            <p style={bodyText}>
              A successful gateway call preserves the tool&apos;s status code, content type, and
              response body. Hackmarket adds the following headers so clients can trace requests,
              observe gateway timing, and manage rate limits without changing the tool&apos;s payload.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Header</th>
                  <th style={thStyle}>Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>
                    <Code>X-HackMarket-Request-Id</Code>
                  </td>
                  <td style={tdStyle}>Stable request ID to include when troubleshooting a call.</td>
                </tr>
                <tr>
                  <td style={tdStyle}>
                    <Code>X-HackMarket-Response-Time-Ms</Code>
                  </td>
                  <td style={tdStyle}>Total gateway-observed response time in milliseconds.</td>
                </tr>
                <tr>
                  <td style={tdStyle}>
                    <Code>X-RateLimit-Remaining</Code>
                  </td>
                  <td style={tdStyle}>Requests remaining in the current 60-second window.</td>
                </tr>
                <tr>
                  <td style={tdStyle}>
                    <Code>X-RateLimit-Limit</Code>
                  </td>
                  <td style={tdStyle}>Maximum requests allowed in that window for the API key.</td>
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
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded.",
    "status": 429,
    "request_id": "req_01HZ4GF0Q1Y8N3X7K2P5W6D9R3",
    "details": {
      "limit": 100,
      "remaining": 0,
      "retry_after_seconds": 60
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
                    <Code>invalid_api_key</Code>
                  </td>
                  <td style={tdStyle}>
                    Key missing, malformed, revoked, or inactive.
                  </td>
                </tr>
                <tr>
                  <td style={tdStyle}>429</td>
                  <td style={tdStyle}>
                    <Code>rate_limit_exceeded</Code>
                  </td>
                  <td style={tdStyle}>
                    The API key exceeded its requests-per-minute limit. Check{" "}
                    <Code>retry_after_seconds</Code> before retrying.
                  </td>
                </tr>
                <tr>
                  <td style={tdStyle}>502</td>
                  <td style={tdStyle}>
                    <Code>TOOL_UNAVAILABLE</Code>
                  </td>
                  <td style={tdStyle}>
                    The upstream tool could not be reached. Retry only when your operation is safe
                    to repeat.
                  </td>
                </tr>
                <tr>
                  <td style={tdStyle}>504</td>
                  <td style={tdStyle}>
                    <Code>TOOL_TIMEOUT</Code>
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
              buyer pays a fixed price and unlocks gateway access for that account. Source-code
              delivery is not part of the current checkout flow. <Code>royalty</Code> is per-call:
              the buyer pays the listed request price and Hackmarket retains a 20% platform fee. This fits
              APIs and live infrastructure — classifiers, generators, transformers that need to
              run for each call.
            </p>
            <p style={bodyText}>
              Live pricing and API contracts are locked to protect existing buyers. Pause the
              listing and contact support before making a contract or pricing-model change.
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
              Official SDKs are not part of the current launch release. The recommendation is the
              same regardless of language: call the REST endpoints directly. Hackmarket&apos;s API is
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
              The gateway currently has a 30-second request timeout. Requests that exceed it
              return a 504 response; automatic async conversion is not available. Design the
              public tool endpoint to finish comfortably inside that limit.
            </FaqItem>

            <FaqItem question="Do I keep ownership of my code?">
              Yes. You retain your copyright and IP rights. Hackmarket stores the submitted source
              archive and deployment artifacts so it can build and operate the listing. Pausing a
              listing disables public access; contact support for account or artifact deletion
              requests under the applicable retention policy.
            </FaqItem>

            <FaqItem question="How do I get paid?">
              Per-call royalties are aggregated into weekly buyer invoices. Eligible completed
              revenue is paid monthly through Stripe Connect after onboarding. Refunds, disputes,
              failed payments, and chargebacks can delay or reduce the amount available to transfer.
            </FaqItem>

            <FaqItem question="What if my tool depends on a third-party API?">
              That is fine as long as you have authorized access to it. You must disclose the
              dependency in your listing description and documentation so consumers know about
              the chain. Tools that secretly proxy to a paid third-party
              API the author does not have rights to are rejected and the account is flagged.
              Pricing should reflect the upstream cost; Hackmarket does not subsidize your
              margin.
            </FaqItem>

            <FaqItem question="Can I update my tool after listing?">
              You can edit descriptive listing fields from your dashboard. Live pricing and I/O
              contracts are locked. Uploading replacement source starts a new processing job, and
              changes that affect the public contract must be reviewed before buyers rely on them.
            </FaqItem>

            <FaqItem question="What languages and runtimes are supported?">
              Automated builds currently detect Python, Node.js, Go, and Rust projects. Provide a
              valid entry command and listening port. Existing Dockerfiles are used when the
              project also contains one of those supported manifests.
            </FaqItem>

            <FaqItem question="Is there a free tier for testing?">
              Public tool demos are rate limited to 10 calls per browser session and server-side
              client window. Authenticated gateway calls follow the tool&apos;s listed pricing and
              entitlement rules. A separate 1,000-call allowance, spending caps, and billing email
              alerts are not part of the current launch release.
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
