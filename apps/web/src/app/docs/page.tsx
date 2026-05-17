"use client";

// Docs is dynamic-imported with ssr:false so the IntersectionObserver
// scroll-spy + hash deep-linking don't cause a hydration flash on the
// first paint. Same pattern as /approver.

import dynamic from "next/dynamic";

const DocsClient = dynamic(() => import("./DocsClient"), {
  ssr: false,
  loading: () => (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        paddingTop: 120,
        textAlign: "center",
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
      }}
    >
      Loading docs…
    </main>
  ),
});

export default function DocsPage() {
  return <DocsClient />;
}
