import type { Metadata } from "next";
import type { ReactNode } from "react";

import CodeBlock from "@/components/docs/CodeBlock";
import { API_BASE } from "@/lib/api";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    "Hackmarket API reference — authentication, rate limits, error handling, and code examples for integrating AI tools.",
};

const publicApiBase = API_BASE.replace(/\/v1$/, "");
const sampleEndpoint = `${publicApiBase}/api/v1/tools/home-accessibility-checker`;

const gettingStartedExamples = [
  {
    language: "curl" as const,
    label: "cURL",
    code: `curl -X POST ${sampleEndpoint} \\
  -H "X-API-Key: your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.zillow.com/homedetails/example-listing",
    "maxImages": 8
  }'`,
  },
  {
    language: "python" as const,
    label: "Python",
    code: `import requests

response = requests.post(
    "${sampleEndpoint}",
    headers={"X-API-Key": "your_api_key_here"},
    json={
        "url": "https://www.zillow.com/homedetails/example-listing",
        "maxImages": 8,
    },
    timeout=30,
)

print(response.json())`,
  },
  {
    language: "javascript" as const,
    label: "JavaScript",
    code: `const response = await fetch("${sampleEndpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": "your_api_key_here",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: "https://www.zillow.com/homedetails/example-listing",
    maxImages: 8,
  }),
});

console.log(await response.json());`,
  },
  {
    language: "nodejs" as const,
    label: "Node.js",
    code: `const axios = require("axios");

async function main() {
  const response = await axios.post(
    "${sampleEndpoint}",
    {
      url: "https://www.zillow.com/homedetails/example-listing",
      maxImages: 8,
    },
    { headers: { "X-API-Key": "your_api_key_here" } }
  );

  console.log(response.data);
}

main();`,
  },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen px-4 py-10 md:px-8" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="mx-auto max-w-7xl">
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>Documentation</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--text)", marginBottom: 6 }}>API Reference</h1>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Hackmarket standardizes auth, routing, rate limiting, and billing so every tool feels consistent to integrate.
          </p>
        </div>

        <section className="mt-4 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <DocCard title="Getting started">
              <ol style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)", listStyle: "none", padding: 0, margin: 0 }}>
                <li>1. Create an account and finish seller or buyer onboarding.</li>
                <li>2. Generate an API key from your dashboard.</li>
                <li>3. Pick a live tool in the marketplace, copy its gateway endpoint, and send requests through Hackmarket.</li>
                <li>4. Send your first request with X-API-Key and a JSON body.</li>
              </ol>
            </DocCard>
            <DocCard title="Authentication">
              <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)" }}>Every request goes through the Hackmarket gateway. Pass your API key in the X-API-Key header. Keep keys server-side, rotate them if they leak, and use separate keys for dev and production.</p>
            </DocCard>
            <DocCard title="Rate limits">
              <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)" }}>API keys are limited to 100 requests per minute by default. Responses include X-RateLimit-Limit, X-RateLimit-Remaining, and X-Hackmarket-Request-Id for tracing.</p>
            </DocCard>
            <DocCard title="Error handling">
              <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)" }}>Expect standard HTTP status codes. 401 means your key is invalid, 429 means you hit the rate limit, and 502 means the seller tool could not be reached. Log the request ID so support can trace it fast.</p>
            </DocCard>
            <DocCard title="Billing">
              <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)" }}>Usage is metered per tool call. Buyers track spend and invoices in the billing dashboard. Sellers see earnings roll up in analytics and payout views.</p>
            </DocCard>
          </div>

          <div className="space-y-4">
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
                <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 4 }}>First request</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>A real request shape to copy from</p>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
                  The featured accessibility tool accepts either a property listing URL or a direct
                  image payload if you already have photos.
                </p>
              </div>
              <div style={{ padding: 20 }}>
                <CodeBlock examples={gettingStartedExamples} />
              </div>
            </div>

            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "18px 20px" }}>
              <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 14 }}>What the gateway adds</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Feature title="Consistent auth" body="One API key pattern across every marketplace tool." />
                <Feature title="Tracing headers" body="Every response includes a request ID for support and debugging." />
                <Feature title="Usage logging" body="Calls are metered for analytics, billing, and seller reporting." />
                <Feature title="Unified errors" body="Rate limits and availability issues come back in predictable shapes." />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function DocCard(props: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "18px 20px" }}>
      <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 10 }}>{props.title}</p>
      {props.children}
    </div>
  );
}

function Feature(props: { title: string; body: string }) {
  return (
    <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{props.title}</p>
      <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>{props.body}</p>
    </div>
  );
}
