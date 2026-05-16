"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  alternateHref: string;
  alternateLabel: string;
  alternateCta: string;
  children: ReactNode;
};

export default function AuthShell({
  eyebrow,
  title,
  description,
  alternateHref,
  alternateLabel,
  alternateCta,
  children,
}: AuthShellProps) {
  return (
    <div
      className="min-h-[calc(100vh-56px)] px-6 py-12"
      style={{
        background:
          "radial-gradient(circle at top, rgba(34,197,94,0.08), transparent 35%), linear-gradient(180deg, #0c1117 0%, #0b1016 100%)",
      }}
    >
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <section>
          <p className="text-xs font-mono uppercase tracking-[0.3em] text-emerald-300/80">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-stone-300">{description}</p>
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-stone-300 shadow-2xl shadow-black/20">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-stone-500">Why sign in</p>
            <ul className="mt-4 space-y-3">
              <li>Create and manage API keys</li>
              <li>Track usage, billing, and tool performance</li>
              <li>List tools and publish live demos</li>
            </ul>
          </div>
        </section>

        <section className="rounded-[32px] border border-white/10 bg-stone-950/85 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.45)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.25em] text-stone-500">Account</p>
              <p className="mt-2 text-sm text-stone-300">{description}</p>
            </div>
            <Link
              href={alternateHref}
              className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-stone-200 transition hover:border-emerald-300/50 hover:text-white"
            >
              {alternateCta}
            </Link>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white">
            {children}
          </div>

          <p className="mt-4 text-center text-sm text-stone-400">
            {alternateLabel}{" "}
            <Link href={alternateHref} className="font-medium text-emerald-300 hover:text-emerald-200">
              {alternateCta}
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
