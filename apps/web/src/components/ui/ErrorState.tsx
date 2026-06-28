"use client";

import Link from "next/link";

interface ErrorStateProps {
  eyebrow?: string;
  title: string;
  message: string;
  code?: string;
  requestId?: string;
  status?: number;
  devDetails?: string;
  retryLabel?: string;
  onRetry?: () => void;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

function metaLabel(status?: number, code?: string): string | null {
  if (status && code) return `${status} / ${code}`;
  if (status) return String(status);
  return code ?? null;
}

export function ErrorState({
  eyebrow = "Recovery mode",
  title,
  message,
  code,
  requestId,
  status,
  devDetails,
  retryLabel = "Try again",
  onRetry,
  primaryHref = "/dashboard",
  primaryLabel = "Go to dashboard",
  secondaryHref = "/marketplace",
  secondaryLabel = "Browse marketplace",
}: ErrorStateProps) {
  const meta = metaLabel(status, code);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16 text-center">
      <section className="w-full max-w-xl rounded-[32px] border border-stone-300/70 bg-[#f8f2df] p-8 shadow-2xl shadow-stone-900/10">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">{eyebrow}</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-stone-950">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-stone-600">{message}</p>

        {(meta || requestId) && (
          <div className="mt-5 rounded-2xl border border-stone-300/70 bg-white/60 px-4 py-3 text-left text-xs text-stone-600">
            {meta && <div>Issue: {meta}</div>}
            {requestId && <div className="mt-1 break-all">Support ID: {requestId}</div>}
          </div>
        )}

        {devDetails && (
          <details className="mt-4 rounded-2xl border border-amber-300/70 bg-amber-50/80 p-4 text-left text-xs text-amber-950">
            <summary className="cursor-pointer font-semibold">Developer details</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words font-mono">{devDetails}</pre>
          </details>
        )}

        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-stone-50 transition hover:bg-stone-800"
            >
              {retryLabel}
            </button>
          )}
          <Link
            href={primaryHref}
            className="rounded-full border border-stone-950/15 bg-white px-5 py-3 text-sm font-semibold text-stone-950 transition hover:border-stone-950/30"
          >
            {primaryLabel}
          </Link>
          <Link
            href={secondaryHref}
            className="rounded-full border border-transparent px-5 py-3 text-sm font-semibold text-stone-600 transition hover:text-stone-950"
          >
            {secondaryLabel}
          </Link>
        </div>
      </section>
    </div>
  );
}
