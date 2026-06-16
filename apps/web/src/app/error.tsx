"use client";

import { useEffect } from "react";
import Link from "next/link";

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
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        We&apos;re sorry about that. You can try again, or head back to the
        home page.
      </p>
      {/* Show the actual error message so we can debug — dev only. */}
      {process.env.NODE_ENV !== "production" && (
        <details
          open
          style={{
            background: "var(--elevated)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 14,
            marginBottom: 18,
            maxWidth: 720,
            width: "100%",
            textAlign: "left",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          <summary style={{ cursor: "pointer", color: "var(--blue)" }}>
            Error details (dev)
          </summary>
          <div
            style={{
              marginTop: 10,
              color: "#dc2626",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
          >
            {error.name}: {error.message || "(no message)"}
          </div>
          {error.digest && (
            <div style={{ marginTop: 6, color: "var(--muted)" }}>
              digest: {error.digest}
            </div>
          )}
          {error.stack && (
            <pre
              style={{
                marginTop: 10,
                fontSize: 11,
                color: "var(--muted)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 360,
                overflow: "auto",
              }}
            >
              {error.stack}
            </pre>
          )}
        </details>
      )}
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
        <Link
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
        </Link>
      </div>
    </div>
  );
}
