import type { Metadata, Viewport } from "next";
import AppProviders from "./AppProviders";
import SiteNav from "@/components/ui/SiteNav";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://hackmarket.io";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f3ef",
};

export const metadata: Metadata = {
  title: {
    default: "Hackmarket — AI Tool Marketplace",
    template: "%s | Hackmarket",
  },
  description:
    "Every hackathon builds tools that die on GitHub. Hackmarket brings them back to life — list, discover, and consume AI tools via a unified API gateway.",
  metadataBase: new URL(APP_URL),
  openGraph: {
    type: "website",
    siteName: "Hackmarket",
    title: "Hackmarket — AI Tool Marketplace",
    description:
      "List, discover, and consume AI tools via a unified API gateway.",
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Hackmarket — AI Tool Marketplace",
    description:
      "List, discover, and consume AI tools via a unified API gateway.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/icon.svg",
  },
  manifest: "/manifest.json",
};

// Self-healing dev script — runs synchronously in <head> before React
// hydrates. If the browser has a leftover service-worker registration or
// Cache-API entry on `localhost` (the rolling source of the
// "Server: Submit Your Build / Client: List Your Tool" hydration error),
// this surgically removes them and forces ONE reload to get a clean state.
// A sessionStorage marker prevents a reload loop after the cleanup.
//
// Only emitted when NODE_ENV !== "production". No-op on clean browsers.
const DEV_CLEAR_SCRIPT = `
(function () {
  if (typeof window === "undefined") return;
  try {
    var FRESH_KEY = "hm.dev.cleaned.v2";
    if (sessionStorage.getItem(FRESH_KEY) === "done") return;

    function reload() {
      sessionStorage.setItem(FRESH_KEY, "done");
      var u = new URL(window.location.href);
      u.searchParams.set("_hm_fresh", String(Date.now()));
      window.location.replace(u.toString());
    }

    var checks = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      checks.push(
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          if (!regs.length) return false;
          return Promise.all(regs.map(function (r) { return r.unregister(); }))
            .then(function () { return true; });
        }).catch(function () { return false; })
      );
    }
    if (typeof caches !== "undefined" && caches.keys) {
      checks.push(
        caches.keys().then(function (keys) {
          if (!keys.length) return false;
          return Promise.all(keys.map(function (k) { return caches.delete(k); }))
            .then(function () { return true; });
        }).catch(function () { return false; })
      );
    }

    if (!checks.length) {
      sessionStorage.setItem(FRESH_KEY, "done");
      return;
    }
    Promise.all(checks).then(function (results) {
      if (results.some(function (r) { return r === true; })) reload();
      else sessionStorage.setItem(FRESH_KEY, "done");
    }).catch(function () {
      sessionStorage.setItem(FRESH_KEY, "done");
    });
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV !== "production";
  return (
    <html lang="en">
      <head>
        {isDev && (
          // eslint-disable-next-line react/no-danger
          <script dangerouslySetInnerHTML={{ __html: DEV_CLEAR_SCRIPT }} />
        )}
      </head>
      <body>
        <AppProviders>
          <SiteNav />
          <div style={{ paddingTop: 56 }}>
            {children}
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
