"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CLERK_PUBLISHABLE_KEY } from "@/lib/env";

export function AuthPageShell({
  children,
  eyebrow,
  title,
  fallbackCopy,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  fallbackCopy: string;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "grid",
        placeItems: "center",
        padding: "96px 20px 48px",
      }}
    >
      <section
        style={{
          width: "min(100%, 440px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--blue)",
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            {eyebrow}
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 26,
              color: "var(--text)",
              margin: 0,
            }}
          >
            {title}
          </h1>
        </div>

        {CLERK_PUBLISHABLE_KEY ? (
          children
        ) : (
          <div
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: 12,
              background: "var(--card)",
              padding: 22,
              boxShadow: "0 18px 44px rgba(26,25,23,0.08)",
            }}
          >
            <p style={{ margin: 0, color: "var(--text)", fontSize: 14, lineHeight: 1.6 }}>
              {fallbackCopy}
            </p>
            <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local`, then enable
              GitHub as a social connection in Clerk. After that, this page will show the real
              hosted auth controls.
            </p>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                marginTop: 18,
                padding: "9px 14px",
                borderRadius: 8,
                background: "var(--blue)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Back to home
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
