function readOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeOrigins(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildContentSecurityPolicy({
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://hackmarket.io",
  apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/v1",
  converterUrl = process.env.NEXT_PUBLIC_CONVERTER_URL ?? "http://localhost:8080",
  nodeEnv = process.env.NODE_ENV ?? "development",
} = {}) {
  const appOrigin = readOrigin(appUrl);
  const apiOrigin = readOrigin(apiUrl);
  const converterOrigin = readOrigin(converterUrl);
  const isProduction = nodeEnv === "production";

  const connectSrc = normalizeOrigins([
    "'self'",
    appOrigin,
    apiOrigin,
    converterOrigin,
    "https://api.clerk.com",
    "https://clerk.com",
    "https://*.clerk.dev",
    "https://*.clerk.accounts.dev",
    "https://checkout.stripe.com",
    "https://q.stripe.com",
  ]);

  const frameSrc = normalizeOrigins([
    "'self'",
    "https://checkout.stripe.com",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://clerk.com",
    "https://*.clerk.dev",
    "https://*.clerk.accounts.dev",
  ]);

  const scriptSrc = normalizeOrigins([
    "'self'",
    "'unsafe-inline'",
    "https://js.stripe.com",
    "https://clerk.com",
    "https://*.clerk.dev",
    "https://*.clerk.accounts.dev",
    !isProduction ? "'unsafe-eval'" : null,
  ]);

  const directives = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["img-src", ["'self'", "data:", "blob:", "https://img.clerk.com", "https://images.clerk.dev"]],
    ["font-src", ["'self'", "data:", "https://fonts.gstatic.com"]],
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]],
    ["script-src", scriptSrc],
    ["connect-src", connectSrc],
    ["frame-src", frameSrc],
    ["form-action", normalizeOrigins(["'self'", "https://checkout.stripe.com", "https://clerk.com", "https://*.clerk.dev", "https://*.clerk.accounts.dev"])],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'", "blob:", "data:"]],
  ];

  if (isProduction && appOrigin?.startsWith("https://")) {
    directives.push(["upgrade-insecure-requests", []]);
  }

  return directives
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

export function buildSecurityHeaders(options = {}) {
  const isProduction = (options.nodeEnv ?? process.env.NODE_ENV ?? "development") === "production";

  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    ...(isProduction
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
      : []),
  ];
}
