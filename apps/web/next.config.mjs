import { buildSecurityHeaders } from "./security-headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,

  // In dev, generate a fresh build ID per process so chunk URLs change
  // every restart. Even if a browser has cached old /_next/static/chunks/*
  // with `immutable` from a previous config, a new build ID makes the new
  // page request URLs the browser has never seen — guaranteed fresh download.
  generateBuildId:
    process.env.NODE_ENV === "production"
      ? undefined
      : async () => `dev-${Date.now()}`,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "images.clerk.dev" },
    ],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
