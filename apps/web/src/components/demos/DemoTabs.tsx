"use client";

// Two-tab wrapper for /tools/[slug]: shows an Interactive Demo tab (when a
// bespoke kc-style demo exists for the slug) plus the schema-driven API
// Playground tab. Ported in spirit from kc:frontend/src/components/Playground.jsx.

import { useState, type ReactNode } from "react";
import { demoFor } from "./registry";

interface DemoTabsProps {
  slug: string;
  apiPlayground: ReactNode;
}

export default function DemoTabs({ slug, apiPlayground }: DemoTabsProps) {
  const Demo = demoFor(slug);
  const hasDemo = Demo !== null;
  const [tab, setTab] = useState<"demo" | "api">(hasDemo ? "demo" : "api");

  if (!hasDemo) {
    return <>{apiPlayground}</>;
  }

  return (
    <div className="kc-demo-scope">
      <div
        role="tablist"
        aria-label="Tool playground"
        className="flex items-center gap-1 mb-6 border-b"
        style={{ borderColor: "var(--line)" }}
      >
        <TabButton active={tab === "demo"} onClick={() => setTab("demo")}>
          Interactive Demo
        </TabButton>
        <TabButton active={tab === "api"} onClick={() => setTab("api")}>
          API Playground
        </TabButton>
      </div>

      <div>
        {tab === "demo" ? (
          <div>
            <Demo />
          </div>
        ) : (
          <div>{apiPlayground}</div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="relative px-4 py-2.5 text-sm font-medium transition-colors"
      style={{
        color: active ? "var(--ink)" : "var(--ink-3)",
      }}
    >
      {children}
      <span
        aria-hidden
        className="absolute left-0 right-0 -bottom-px h-0.5 transition-opacity"
        style={{
          background: "var(--primary)",
          opacity: active ? 1 : 0,
        }}
      />
    </button>
  );
}
