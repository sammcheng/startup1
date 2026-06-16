"use client";

// Approver dashboard runs on the client so it can use Clerk session state
// and generate PDFs via jsPDF without SSR hydration mismatches.

import dynamic from "next/dynamic";

const ApproverClient = dynamic(() => import("./ApproverClient"), {
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
      Loading approver dashboard…
    </main>
  ),
});

export default function ApproverPage() {
  return <ApproverClient />;
}
