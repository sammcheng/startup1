"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SIDEBAR_ITEMS = [
  { href: "/dashboard",              label: "Overview",    icon: "▣" },
  { href: "/marketplace",            label: "Marketplace", icon: "⊞" },
  { href: "/dashboard/api-keys",     label: "API Keys",    icon: "⌘" },
  { href: "/dashboard/usage",        label: "Usage",       icon: "↗" },
  { href: "/dashboard/billing",      label: "Billing",     icon: "◎" },
  { href: "/dashboard/seller",       label: "Seller",      icon: "⊕" },
  { href: "/publish",                label: "List a Tool", icon: "＋" },
  { href: "/docs",                   label: "Docs",        icon: "◈" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <div className="dash-layout">
      <aside className="dash-sidebar">
        <p style={{
          fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase",
          letterSpacing: ".12em", color: "var(--faint)", marginBottom: 12, padding: "0 12px",
        }}>
          Navigation
        </p>
        {SIDEBAR_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`dash-nav-item${isActive(item.href) ? " active" : ""}`}
          >
            <span style={{ fontSize: 14, opacity: .7 }}>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}

        <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <div style={{ padding: "10px 12px" }}>
            <Link
              href="/publish"
              style={{
                display: "block", padding: "8px 12px", borderRadius: 8,
                background: "var(--blue)", color: "#fff", fontSize: 13,
                fontWeight: 600, textDecoration: "none", textAlign: "center",
              }}
            >
              + Publish a tool
            </Link>
          </div>
        </div>
      </aside>

      <main className="dash-main">
        {children}
      </main>
    </div>
  );
}
