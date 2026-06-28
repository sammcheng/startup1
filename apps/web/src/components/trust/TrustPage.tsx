import Link from "next/link";
import type { ReactNode } from "react";

interface TrustPageProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function TrustPage({ eyebrow, title, description, children }: TrustPageProps) {
  return (
    <main className="trust-page">
      <section className="trust-hero">
        <p className="trust-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </section>
      <section className="trust-shell">{children}</section>
      <section className="trust-cta">
        <div>
          <p className="trust-eyebrow">Need help?</p>
          <h2>Talk to a human before launch decisions.</h2>
          <p>
            For billing, marketplace safety, seller review, or account questions, contact
            Hackmarket support.
          </p>
        </div>
        <Link href="/support" className="trust-primary-link">
          Contact support
        </Link>
      </section>
    </main>
  );
}

export function TrustSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="trust-section">
      <h2>{title}</h2>
      <div>{children}</div>
    </article>
  );
}

export function TrustList({ items }: { items: string[] }) {
  return (
    <ul className="trust-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
