"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { useCurrentAccount } from "@/hooks/useAuth";

export default function SiteNav() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn, signOut, user } = useCurrentAccount();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`site-nav${scrolled ? " scrolled" : ""}`}>
      {/* Logo */}
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 6, background: "var(--blue)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5" height="5" rx="1" fill="white" />
            <rect x="8" y="1" width="5" height="5" rx="1" fill="white" fillOpacity=".5" />
            <rect x="1" y="8" width="5" height="5" rx="1" fill="white" fillOpacity=".5" />
            <rect x="8" y="8" width="5" height="5" rx="1" fill="white" />
          </svg>
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text)", letterSpacing: "-.01em" }}>
          Hackmarket
        </span>
      </Link>

      {/* Center links */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {[
          { href: "/marketplace", label: "Marketplace" },
          { href: "/pricing", label: "Pricing" },
          { href: "/dashboard", label: "Dashboard" },
          { href: "/docs", label: "Docs" },
        ].map((l) => (
          <Link key={l.href} href={l.href} style={{
            padding: "6px 12px", borderRadius: 6, fontSize: 13.5,
            color: pathname.startsWith(l.href) ? "var(--text)" : "var(--muted)",
            fontFamily: "var(--font-body)", fontWeight: 500,
          }}>
            {l.label}
          </Link>
        ))}
      </div>

      {/* Right actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isLoaded && isSignedIn ? (
          <>
            <Link
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                color: "var(--text)",
                background: "var(--card)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {user?.imageUrl ? (
                <span
                  aria-hidden="true"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    backgroundImage: `url(${user.imageUrl})`,
                    backgroundPosition: "center",
                    backgroundSize: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <UserRound size={16} />
              )}
              {user?.firstName ?? user?.username ?? "Account"}
            </Link>
            <button
              type="button"
              onClick={() => void signOut?.()}
              aria-label="Sign out"
              title="Sign out"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--muted)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <LogOut size={16} />
            </button>
          </>
        ) : (
          <Link
            href="/sign-in"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              color: "var(--text)",
              background: "var(--card)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <UserRound size={16} />
            Sign in
          </Link>
        )}
        <Link
          href="/submit"
          data-cta="submit-your-build"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 18px",
            borderRadius: 8,
            background: "var(--blue)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-body)",
          }}
        >
          Submit Your Build
        </Link>
      </div>
    </nav>
  );
}
