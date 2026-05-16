"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function Nav() {
  const pathname = usePathname();
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
        {[{ href: "/marketplace", label: "Marketplace" }, { href: "/docs", label: "Docs" }].map((l) => (
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
        <Link
          href="/publish"
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
          List Your Tool
        </Link>
      </div>
    </nav>
  );
}
