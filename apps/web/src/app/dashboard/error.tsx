"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: ".12em",
          color: "var(--faint)",
          marginBottom: 12,
        }}
      >
        Dashboard Error
      </p>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 700,
          color: "var(--text)",
          marginBottom: 10,
        }}
      >
        Something went wrong
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "var(--muted)",
          maxWidth: 360,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        We couldn&apos;t load this page. This might be temporary — try refreshing.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontWeight: 600,
          padding: "10px 20px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--text)",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
