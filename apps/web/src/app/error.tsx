"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
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
        Something went wrong
      </p>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(22px, 3vw, 30px)",
          fontWeight: 700,
          color: "var(--text)",
          marginBottom: 10,
        }}
      >
        An unexpected error occurred
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--muted)",
          maxWidth: 400,
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        We&apos;re sorry about that. You can try again, or head back to the
        home page.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
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
        <a
          href="/"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--blue)",
            color: "#fff",
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Go home
        </a>
      </div>
    </div>
  );
}
