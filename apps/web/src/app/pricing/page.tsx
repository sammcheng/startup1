import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Hackmarket pricing for buyers and sellers.",
};

const plans = [
  {
    name: "Buyers",
    price: "Pay per use",
    description: "Call verified tools through one gateway and one API-key workflow.",
    features: [
      "No subscription required for marketplace browsing",
      "Per-request or one-time purchase pricing set by sellers",
      "Usage history, API keys, and billing visibility in your dashboard",
      "Gateway-level auth, rate limits, and request logging",
    ],
  },
  {
    name: "Sellers",
    price: "20% platform fee",
    description: "List tools, process buyer requests, and track revenue without building billing from scratch.",
    features: [
      "Free submission and review flow during MVP launch",
      "Tools stay in review until processed and approved",
      "Seller dashboard for requests, revenue, latency, and status",
      "Monthly payouts require completed Stripe Connect onboarding",
      "Refunds and disputes can reduce eligible seller revenue",
    ],
  },
];

export default function PricingPage() {
  return (
    <main className="trust-page">
      <section className="trust-hero">
        <p className="trust-eyebrow">Pricing</p>
        <h1>Simple pricing for a marketplace that actually runs.</h1>
        <p>
          Hackmarket charges buyers based on seller-defined tool pricing. Sellers can list
          during MVP launch, then monetize through marketplace purchases and usage.
        </p>
      </section>

      <section className="pricing-grid">
        {plans.map((plan) => (
          <article key={plan.name} className="pricing-card">
            <p className="trust-eyebrow">{plan.name}</p>
            <h2>{plan.price}</h2>
            <p>{plan.description}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="trust-cta">
        <div>
          <p className="trust-eyebrow">Transparent terms</p>
          <h2>Know the fee before you publish or purchase.</h2>
          <p>
            Hackmarket retains 20% of completed marketplace revenue. Eligible seller balances are
            transferred monthly through Stripe Connect and may be adjusted for refunds, disputes,
            fraud, or chargebacks.
          </p>
        </div>
        <Link href="/seller-agreement" className="trust-primary-link">
          Seller terms
        </Link>
      </section>
    </main>
  );
}
