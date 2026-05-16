"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "@/lib/api";

const SIDEBAR_ITEMS = [
  { href: "/dashboard",              label: "Overview",    icon: "▣" },
  { href: "/marketplace",            label: "Marketplace", icon: "⊞" },
  { href: "/dashboard/api-keys",     label: "API Keys",    icon: "⌘" },
  { href: "/dashboard/usage",        label: "Usage",       icon: "↗" },
  { href: "/dashboard/billing",      label: "Billing",     icon: "◎" },
  { href: "/dashboard/seller",       label: "Seller",      icon: "⊕" },
  { href: "/dashboard/tools/new",    label: "List a Tool", icon: "＋" },
  { href: "/docs",                   label: "Docs",        icon: "◈" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken, isLoaded: isAuthLoaded } = useAuth();
  const [syncState, setSyncState] = useState<"loading" | "ready" | "error">("loading");
  const [syncMessage, setSyncMessage] = useState("Preparing your dashboard…");

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "User"
    : "User";
  const initials = displayName[0]?.toUpperCase() ?? "U";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const syncPayload = useMemo(() => {
    if (!user?.primaryEmailAddress?.emailAddress) return null;
    return {
      email: user.primaryEmailAddress.emailAddress,
      username: user.username || undefined,
      display_name:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.fullName ||
        user.username ||
        undefined,
      avatar_url: user.imageUrl || undefined,
    };
  }, [user]);

  const syncAccount = useCallback(async () => {
    if (!isAuthLoaded || !isUserLoaded) return;
    if (!user) {
      setSyncState("ready");
      return;
    }
    if (!syncPayload) {
      setSyncState("error");
      setSyncMessage("We couldn’t determine your account email from Clerk yet.");
      return;
    }

    setSyncState("loading");
    setSyncMessage("Preparing your dashboard…");

    try {
      const token = await getToken();
      await api.post("/auth/sync", syncPayload, { token });
      setSyncState("ready");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "We couldn’t connect your account to the API yet.";
      setSyncState("error");
      setSyncMessage(message);
    }
  }, [getToken, isAuthLoaded, isUserLoaded, syncPayload, user]);

  useEffect(() => {
    if (!isAuthLoaded || !isUserLoaded) return;
    void syncAccount();
  }, [isAuthLoaded, isUserLoaded, syncAccount]);

  if (syncState !== "ready") {
    return (
      <div className="dash-layout">
        <aside className="dash-sidebar">
          <p
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
              color: "var(--faint)",
              marginBottom: 12,
              padding: "0 12px",
            }}
          >
            Navigation
          </p>
        </aside>
        <main className="dash-main">
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 24,
              maxWidth: 520,
            }}
          >
            <p
              style={{
                fontSize: 10.5,
                fontFamily: "var(--font-mono)",
                textTransform: "uppercase",
                letterSpacing: ".1em",
                color: "var(--faint)",
                marginBottom: 10,
              }}
            >
              Account setup
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
              {syncState === "loading" ? "Getting things ready" : "We hit an account sync snag"}
            </h1>
            <p style={{ color: "var(--muted)", lineHeight: 1.6, marginBottom: syncState === "error" ? 16 : 0 }}>
              {syncMessage}
            </p>
            {syncState === "error" ? (
              <button
                type="button"
                onClick={() => void syncAccount()}
                style={{
                  background: "var(--blue)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dash-layout">
      {/* Sidebar */}
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

        {/* User info */}
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <div style={{ padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "var(--blue-dim)", border: "1px solid rgba(37,99,235,.18)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: "var(--blue)",
                fontFamily: "var(--font-mono)",
              }}>
                {initials}
              </div>
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: {
                      width: "28px",
                      height: "28px",
                    },
                  },
                }}
              />
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{displayName}</div>
            {email && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>
                {email}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="dash-main">
        {children}
      </main>
    </div>
  );
}
