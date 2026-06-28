import type { Metadata } from "next";
import { TrustList, TrustPage, TrustSection } from "@/components/trust/TrustPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Hackmarket collects, uses, and protects marketplace data.",
};

export default function PrivacyPage() {
  return (
    <TrustPage
      eyebrow="Privacy"
      title="Privacy Policy"
      description="This policy explains what Hackmarket collects, why it is used, and how users can ask for help with their data. It should be reviewed by counsel before a full public launch."
    >
      <TrustSection title="Information we collect">
        <TrustList
          items={[
            "Account information from Clerk, including email, username, display name, avatar, and authentication identifiers.",
            "Marketplace activity such as submitted tools, purchases, API keys, tool invocations, usage logs, and dashboard analytics.",
            "Billing and payout metadata from Stripe, including checkout, subscription, invoice, payment, and connected-account references.",
            "Uploaded tool source packages, configuration files, repository URLs, and processing job metadata needed to review and deploy seller tools.",
            "Operational logs such as request IDs, error types, latency, queue health, and webhook delivery status.",
          ]}
        />
      </TrustSection>

      <TrustSection title="How we use data">
        <TrustList
          items={[
            "Authenticate users and keep buyer and seller dashboards scoped to the signed-in account.",
            "Process seller submissions, run deployment workers, and show live status for queued jobs.",
            "Route buyer requests through the gateway, enforce rate limits, log usage, and calculate billing records.",
            "Detect abuse, debug incidents, recover failed jobs, and protect marketplace reliability.",
            "Send operational notifications, respond to support requests, and comply with legal obligations.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Sharing and processors">
        <p>
          Hackmarket uses infrastructure and service providers such as Vercel, Render,
          Clerk, Stripe, AWS/S3, GitHub Container Registry, OpenRouter, and alerting
          webhooks to operate the platform. Data is shared with these processors only as
          needed to provide authentication, hosting, storage, billing, tool processing,
          observability, and support.
        </p>
      </TrustSection>

      <TrustSection title="Retention and deletion">
        <p>
          Account, billing, usage, and submission records are retained while needed for
          product functionality, financial records, abuse prevention, security, and legal
          compliance. Users can request account review or deletion through support.
        </p>
      </TrustSection>

      <TrustSection title="Contact">
        <p>
          For privacy questions, email <a href="mailto:support@hackmarket.io">support@hackmarket.io</a>.
        </p>
      </TrustSection>
    </TrustPage>
  );
}
