import path from "node:path";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnvConfig(path.resolve(__dirname, ".."));

function isStrictDeployEnv(env) {
  return env.VERCEL === "1" ||
    env.CI === "true" ||
    env.HACKMARKET_STRICT_ENV === "true";
}

function isBlank(value) {
  return value == null || value.trim() === "";
}

function parseUrl(name, value, errors) {
  try {
    return new URL(value);
  } catch {
    errors.push(`${name} must be a valid absolute URL.`);
    return null;
  }
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function validateRequiredPublicUrl(name, value, errors, strictDeployEnv) {
  if (isBlank(value)) {
    errors.push(`${name} is required for deploy builds.`);
    return;
  }

  const parsed = parseUrl(name, value, errors);
  if (!parsed) return;

  if (strictDeployEnv) {
    if (parsed.protocol !== "https:") {
      errors.push(`${name} must use https in deploy builds.`);
    }
    if (isLocalHostname(parsed.hostname)) {
      errors.push(`${name} cannot point to localhost in deploy builds.`);
    }
  }
}

function validateOptionalPublicUrl(name, value, errors, strictDeployEnv) {
  if (isBlank(value)) return;

  const parsed = parseUrl(name, value, errors);
  if (!parsed) return;

  if (strictDeployEnv && isLocalHostname(parsed.hostname)) {
    errors.push(`${name} cannot point to localhost in deploy builds.`);
  }
}

function validatePublishableKey(value, errors, strictDeployEnv) {
  if (isBlank(value)) {
    if (strictDeployEnv) {
      errors.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required for deploy builds.");
    }
    return;
  }
  if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(value.trim())) {
    errors.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must look like a Clerk publishable key.");
  }
}

export function validateEnv(env = process.env) {
  const errors = [];
  const strictDeployEnv = isStrictDeployEnv(env);

  validateRequiredPublicUrl("NEXT_PUBLIC_API_URL", env.NEXT_PUBLIC_API_URL, errors, strictDeployEnv);
  validateRequiredPublicUrl("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL, errors, strictDeployEnv);
  validateOptionalPublicUrl("NEXT_PUBLIC_CONVERTER_URL", env.NEXT_PUBLIC_CONVERTER_URL, errors, strictDeployEnv);
  validatePublishableKey(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, errors, strictDeployEnv);

  return errors;
}

if (process.argv[1] === __filename) {
  const errors = validateEnv();

  if (errors.length > 0) {
    console.error("Frontend environment validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
}
