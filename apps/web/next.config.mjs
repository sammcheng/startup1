/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  transpilePackages: ["@hackmarket/shared"],

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
    const isProd = process.env.NODE_ENV === "production";
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // In production, Next already hashes /_next/static/* filenames, so a
      // year-long immutable cache is safe. In dev, the SAME path can serve
      // freshly-recompiled JS — long-lived caching there strands the
      // browser on stale bundles (the hydration mismatch reported), so we
      // tell the browser not to cache dev chunks at all.
      isProd
        ? {
            source: "/_next/static/(.*)",
            headers: [
              { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
            ],
          }
        : {
            source: "/_next/static/(.*)",
            headers: [
              { key: "Cache-Control", value: "no-store, must-revalidate" },
            ],
          },
    ];
  },
};

export default nextConfig;
