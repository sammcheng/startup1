"use client";

import { useMemo, useState } from "react";

import type { DocumentationCodeExample, DocumentationLanguage } from "@/types/docs";

interface CodeBlockProps {
  examples: DocumentationCodeExample[];
}

const languageOrder: DocumentationLanguage[] = ["curl", "python", "javascript", "nodejs"];

export default function CodeBlock({ examples }: CodeBlockProps) {
  const orderedExamples = useMemo(() => {
    return [...examples].sort(
      (left, right) => languageOrder.indexOf(left.language) - languageOrder.indexOf(right.language)
    );
  }, [examples]);

  const [activeLanguage, setActiveLanguage] = useState<DocumentationLanguage>(
    orderedExamples[0]?.language ?? "curl"
  );
  const [copied, setCopied] = useState(false);

  const activeExample =
    orderedExamples.find((example) => example.language === activeLanguage) ?? orderedExamples[0];

  async function handleCopy() {
    if (!activeExample) {
      return;
    }
    await navigator.clipboard.writeText(activeExample.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!activeExample) {
    return (
      <div className="rounded-[24px] border border-stone-800 bg-[#09111a] p-6 text-sm text-stone-400">
        No code examples available yet.
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[24px] border border-stone-800 bg-[#09111a] shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-3 border-b border-stone-800 bg-[#0d1724] px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {orderedExamples.map((example) => (
            <button
              key={example.language}
              type="button"
              onClick={() => setActiveLanguage(example.language)}
              className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                example.language === activeLanguage
                  ? "bg-sky-300 text-stone-950"
                  : "border border-stone-700 text-stone-300 hover:border-sky-300"
              }`}
            >
              {example.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded-full border border-stone-700 px-4 py-2 text-xs text-stone-300 transition hover:border-sky-300 hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <pre className="overflow-x-auto p-6 text-sm leading-7 text-stone-100">
        <code dangerouslySetInnerHTML={{ __html: highlight(activeExample.code, activeExample.language) }} />
      </pre>
    </section>
  );
}

function highlight(code: string, language: DocumentationLanguage) {
  const escaped = escapeHtml(code);

  if (language === "curl") {
    return escaped
      .replace(/\b(curl|POST|GET|PUT|DELETE)\b/g, '<span class="text-sky-300">$1</span>')
      .replace(/(-X|-H|-d)/g, '<span class="text-amber-300">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="text-emerald-300">$1</span>');
  }

  if (language === "python") {
    return escaped
      .replace(/\b(import|async|await|print)\b/g, '<span class="text-sky-300">$1</span>')
      .replace(/\b(requests|response|result)\b/g, '<span class="text-violet-300">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="text-emerald-300">$1</span>');
  }

  return escaped
    .replace(/\b(const|let|await|async|function|throw|new|require)\b/g, '<span class="text-sky-300">$1</span>')
    .replace(/\b(fetch|axios|console)\b/g, '<span class="text-violet-300">$1</span>')
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="text-emerald-300">$1</span>');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
