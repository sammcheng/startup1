"use client";

import { useState } from "react";

export default function JSONOutput({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  async function handleCopy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (!content) {
    return <EmptyState message="No JSON output yet." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-stone-200">JSON response</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300 transition hover:border-cyan-300"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[420px] overflow-auto rounded-2xl border border-stone-800 bg-black/40 p-4 font-mono text-xs leading-6 text-emerald-200">
        <code>{content}</code>
      </pre>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-sm text-stone-500">{message}</p>;
}
