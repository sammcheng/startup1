import type { Metadata } from "next";
import { TrustList, TrustPage, TrustSection } from "@/components/trust/TrustPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Hackmarket marketplace terms for buyers and sellers.",
};

export default function TermsPage() {
  return (
    <TrustPage
      eyebrow="Terms"
      title="Terms of Service"
      description="These terms set baseline rules for using Hackmarket. They are launch-ready product copy, but should be reviewed by counsel before broad commercial release."
    >
      <TrustSection title="Using Hackmarket">
        <TrustList
          items={[
            "You must use a real account and keep authentication credentials, API keys, and billing access secure.",
            "You may not abuse the gateway, bypass rate limits, scrape private data, attack seller services, or use tools for unlawful activity.",
            "Hackmarket may suspend accounts, keys, tools, or purchases to protect users, infrastructure, billing integrity, or legal compliance.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Marketplace purchases">
        <TrustList
          items={[
            "Tool pricing is set by sellers and displayed before purchase or usage whenever possible.",
            "Buyer requests are routed through Hackmarket's gateway for authentication, metering, billing, and reliability controls.",
            "Refunds, credits, and disputed charges may be reviewed case by case based on logs, tool availability, and Stripe payment records.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Seller submissions">
        <TrustList
          items={[
            "Sellers are responsible for having the rights to submit, license, operate, and monetize their tools.",
            "Submitted tools must not include malware, credential theft, hidden mining, unauthorized data collection, or intentionally deceptive behavior.",
            "Hackmarket may review, reject, pause, retry, or remove tools that fail processing, create risk, violate policy, or harm users.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Service availability">
        <p>
          Hackmarket is operated as a launch-stage marketplace. We work to keep the API,
          worker, database, Redis queue, billing webhooks, and seller tools reliable, but
          no service is guaranteed to be uninterrupted or error-free.
        </p>
      </TrustSection>

      <TrustSection title="Contact">
        <p>
          For terms or account questions, use the <a href="/support">support page</a>.
        </p>
      </TrustSection>
    </TrustPage>
  );
}
