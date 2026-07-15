import type { Metadata } from "next";
import { TrustList, TrustPage, TrustSection } from "@/components/trust/TrustPage";

export const metadata: Metadata = {
  title: "Seller Agreement",
  description: "Seller rules for submitting and monetizing tools on Hackmarket.",
};

export default function SellerAgreementPage() {
  return (
    <TrustPage
      eyebrow="Seller Agreement"
      title="Rules for tools people can trust."
      description="Hackmarket sellers can monetize useful tools, but production users need clear safety, ownership, support, and payout expectations."
    >
      <TrustSection title="Seller responsibilities">
        <TrustList
          items={[
            "Submit only code, documentation, demos, and assets you own or have permission to commercialize.",
            "Keep tool documentation accurate, including input schema, output schema, limitations, setup requirements, and pricing.",
            "Do not include secrets, customer data, private keys, malware, spyware, hidden network calls, or undisclosed third-party billing.",
            "Respond to support, incident, refund, and abuse requests in a reasonable time.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Review and deployment">
        <TrustList
          items={[
            "Submissions may be queued, processed, retried, rejected, paused, or manually approved by admins.",
            "Tools must have a healthy endpoint before they can be approved live.",
            "Hackmarket may pause or remove tools that fail health checks, produce unsafe outputs, break billing, or harm platform reliability.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Revenue and payouts">
        <TrustList
          items={[
            "Seller payouts require completed Stripe Connect onboarding and valid tax/payment information where applicable.",
            "Hackmarket retains a 20% platform fee from completed marketplace revenue.",
            "Eligible balances are paid monthly and may be adjusted for refunds, disputes, fraud, abuse, chargebacks, or credits.",
          ]}
        />
      </TrustSection>

      <TrustSection title="Operational standards">
        <p>
          Sellers should treat listed tools as production services. Keep repositories
          maintainable, avoid breaking API contracts without notice, and fix incidents
          quickly when Hackmarket reports gateway errors, latency, or failed invocations.
        </p>
      </TrustSection>
    </TrustPage>
  );
}
