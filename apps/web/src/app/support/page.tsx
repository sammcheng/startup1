import type { Metadata } from "next";
import Link from "next/link";
import { TrustList, TrustPage, TrustSection } from "@/components/trust/TrustPage";

export const metadata: Metadata = {
  title: "Support",
  description: "Get support for Hackmarket accounts, billing, tools, and marketplace safety.",
};

export default function SupportPage() {
  return (
    <TrustPage
      eyebrow="Support"
      title="Support for buyers, sellers, and operators."
      description="Use this page to route launch issues quickly: account access, billing, failed submissions, API keys, tool invocation failures, or marketplace safety concerns."
    >
      <div className="support-grid">
        <article className="support-card">
          <h2>Support requests</h2>
          <p>
            Open a{" "}
            <a href="https://github.com/sammcheng/startup1/issues/new" rel="noreferrer" target="_blank">
              GitHub support issue
            </a>
            .
          </p>
          <p className="support-small">
            Do not post API keys, passwords, billing details, personal data, or other secrets.
          </p>
        </article>
        <article className="support-card">
          <h2>Status checks</h2>
          <p>
            Operators should verify <code>/health</code>, <code>/ready</code>, queue depth,
            worker heartbeat, Stripe webhooks, and failed processing jobs.
          </p>
          <Link href="/admin">Open admin operations</Link>
        </article>
      </div>

      <TrustSection title="What to include">
        <TrustList
          items={[
            "Whether you are acting as a buyer, seller, or admin, without posting private account details.",
            "Tool name, slug, submission ID, processing job ID, or API request ID when available.",
            "Screenshots or exact error messages for dashboard and checkout issues.",
            "Whether the issue blocks launch, billing, tool access, or production reliability.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Safety and abuse">
        <p>
          Report suspicious tools, stolen code, hidden data collection, billing fraud, malicious
          outputs, or attempts to bypass gateway controls. For a sensitive report, open a
          non-sensitive issue requesting private follow-up and do not include exploit details or
          credentials publicly.
        </p>
      </TrustSection>
    </TrustPage>
  );
}
