const LOCAL_API_URL = "http://localhost:8000/v1";
const LOCAL_CONVERTER_URL = "http://localhost:8080";
const PROD_APP_URL = "https://hackmarket.io";
const CONFIGURED_CONVERTER_URL =
  process.env.NEXT_PUBLIC_CONVERTER_URL?.trim() ?? "";

function readPublicEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const API_BASE = readPublicEnv("NEXT_PUBLIC_API_URL", LOCAL_API_URL);
export const APP_URL = readPublicEnv("NEXT_PUBLIC_APP_URL", PROD_APP_URL);
export const CONVERTER_URL = readPublicEnv(
  "NEXT_PUBLIC_CONVERTER_URL",
  LOCAL_CONVERTER_URL,
);
export const CONVERTER_ENABLED =
  CONFIGURED_CONVERTER_URL.length > 0 || process.env.NODE_ENV !== "production";
export const ALLOW_CONVERTER_CATALOG_FALLBACK =
  process.env.NODE_ENV !== "production" && CONVERTER_ENABLED;
export const CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || null;
export const DEMO_API_KEY =
  process.env.NEXT_PUBLIC_DEMO_API_KEY?.trim() || "";

export function isLocalServiceUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function getGatewayBaseUrl(): string {
  if (API_BASE.endsWith("/v1")) {
    return `${API_BASE.slice(0, -3)}/api/v1`;
  }
  return `${API_BASE}/api/v1`;
}

export function shouldSkipBuildTimeFetch(value: string): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" && isLocalServiceUrl(value);
}
