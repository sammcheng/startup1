"use strict";

const path = require("path");

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_IMAGE_DIMENSION = 2048;
const DEFAULT_IMAGE_QUALITY = 85;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 45000;
const DEFAULT_LISTING_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_MAX_LISTING_HTML_BYTES = 2 * 1024 * 1024;
const DEFAULT_REMOTE_IMAGE_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_OPENROUTER_TIMEOUT_MS = 20000;
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o";
const DEFAULT_PUBLIC_APP_URL = "https://hackmarket.io";
const DEFAULT_GATEWAY_KEY_ID = "launch-1";
const DEFAULT_GATEWAY_SIGNATURE_TTL_SECONDS = 300;

const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function parseNumberEnv(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

function parseAllowedOrigins(rawValue = process.env.ALLOWED_ORIGINS) {
  if (!rawValue || rawValue.trim() === "") {
    return ["*"];
  }

  const origins = rawValue
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length ? origins : ["*"];
}

function parseBooleanEnv(name, fallback = false) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  return ["1", "true", "yes", "on"].includes(rawValue.trim().toLowerCase());
}

function getRuntimeConfig() {
  const maxFileSize = parseNumberEnv("MAX_FILE_SIZE", DEFAULT_MAX_FILE_SIZE);
  const maxFiles = parseNumberEnv("MAX_FILES", DEFAULT_MAX_FILES);
  const tempDir = process.env.TEMP_DIR || path.join(__dirname, "tmp");

  return {
    port: parseNumberEnv("PORT", 3000),
    rateLimitWindowMs: parseNumberEnv(
      "RATE_LIMIT_WINDOW_MS",
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    ),
    rateLimitMaxRequests: parseNumberEnv(
      "RATE_LIMIT_MAX_REQUESTS",
      DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    ),
    maxFileSize,
    maxFiles,
    maxInlineImages: parseNumberEnv("MAX_INLINE_IMAGES", maxFiles),
    tempDir,
    uploadDir: process.env.UPLOAD_DIR || path.join(tempDir, "uploads"),
    analysisTimeoutMs: parseNumberEnv(
      "ANALYSIS_TIMEOUT_MS",
      DEFAULT_ANALYSIS_TIMEOUT_MS,
    ),
    publicAppUrl: process.env.PUBLIC_APP_URL || DEFAULT_PUBLIC_APP_URL,
    allowedOrigins: parseAllowedOrigins(),
    openrouterTimeoutMs: parseNumberEnv(
      "OPENROUTER_TIMEOUT_MS",
      DEFAULT_OPENROUTER_TIMEOUT_MS,
    ),
    openrouterModel:
      process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
    maxImageWidth: parseNumberEnv(
      "MAX_IMAGE_WIDTH",
      DEFAULT_MAX_IMAGE_DIMENSION,
    ),
    maxImageHeight: parseNumberEnv(
      "MAX_IMAGE_HEIGHT",
      DEFAULT_MAX_IMAGE_DIMENSION,
    ),
    imageQuality: parseNumberEnv("IMAGE_QUALITY", DEFAULT_IMAGE_QUALITY),
    listingFetchTimeoutMs: parseNumberEnv(
      "LISTING_FETCH_TIMEOUT_MS",
      DEFAULT_LISTING_FETCH_TIMEOUT_MS,
    ),
    maxListingHtmlBytes: parseNumberEnv(
      "MAX_LISTING_HTML_BYTES",
      DEFAULT_MAX_LISTING_HTML_BYTES,
    ),
    remoteImageFetchTimeoutMs: parseNumberEnv(
      "REMOTE_IMAGE_FETCH_TIMEOUT_MS",
      DEFAULT_REMOTE_IMAGE_FETCH_TIMEOUT_MS,
    ),
    maxRemoteImageBytes: parseNumberEnv(
      "MAX_REMOTE_IMAGE_BYTES",
      DEFAULT_MAX_REMOTE_IMAGE_BYTES,
    ),
    gatewayPublicKey: process.env.HACKMARKET_GATEWAY_PUBLIC_KEY?.trim() || "",
    gatewayKeyId:
      process.env.HACKMARKET_GATEWAY_KEY_ID?.trim() || DEFAULT_GATEWAY_KEY_ID,
    gatewayToolSlug: process.env.HACKMARKET_TOOL_SLUG?.trim() || "",
    gatewaySignatureTtlSeconds: parseNumberEnv(
      "HACKMARKET_GATEWAY_SIGNATURE_TTL_SECONDS",
      DEFAULT_GATEWAY_SIGNATURE_TTL_SECONDS,
    ),
    allowUnsignedGatewayRequests: parseBooleanEnv(
      "ALLOW_UNSIGNED_GATEWAY_REQUESTS",
      process.env.NODE_ENV === "test",
    ),
    allowedMimeTypes: [...allowedMimeTypes],
  };
}

function isAnalysisProviderConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

module.exports = {
  allowedMimeTypes,
  getRuntimeConfig,
  isAnalysisProviderConfigured,
  parseAllowedOrigins,
  parseBooleanEnv,
  parseNumberEnv,
};
