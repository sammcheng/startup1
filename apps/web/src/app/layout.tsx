import type { Metadata, Viewport } from "next";
import AppProviders from "./AppProviders";
import SiteNav from "@/components/ui/SiteNav";
import { APP_URL } from "@/lib/env";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
