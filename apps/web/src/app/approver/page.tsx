"use client";

// Approver dashboard runs entirely on the client — it reads from
// localStorage on first render (different from the server's empty state)
// and generates PDFs via jsPDF, neither of which survive SSR cleanly.
// Skipping SSR sidesteps the hydration mismatch and is appropriate for
// an admin-only page that's behind a token gate anyway.

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
