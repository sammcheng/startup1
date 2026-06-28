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
          <h2>Email</h2>
          <p>
            Reach us at <a href="mailto:support@hackmarket.io">support@hackmarket.io</a>.
          </p>
          <p className="support-small">Use this for account, billing, seller, privacy, and abuse requests.</p>
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
            "Your account email and whether you are acting as a buyer, seller, or admin.",
            "Tool name, slug, submission ID, processing job ID, or API request ID when available.",
            "Screenshots or exact error messages for dashboard and checkout issues.",
            "Whether the issue blocks launch, billing, tool access, or production reliability.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Safety and abuse">
        <p>
          Report suspicious tools, stolen code, hidden data collection, billing fraud, malicious
          outputs, or attempts to bypass gateway controls to support immediately.
        </p>
      </TrustSection>
    </TrustPage>
  );
}
