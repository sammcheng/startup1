import test from "node:test";
import assert from "node:assert/strict";

import { validateEnv } from "./validate-env.mjs";

test("accepts valid deploy URLs and Clerk key", () => {
  const errors = validateEnv({
    NEXT_PUBLIC_API_URL: "https://api.hackmarket.io/v1",
    NEXT_PUBLIC_APP_URL: "https://hackmarket.io",
    NEXT_PUBLIC_CONVERTER_URL: "https://converter.hackmarket.io",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5kZXYk",
    CLERK_SECRET_KEY: "sk_test_abc123",
  });

  assert.deepEqual(errors, []);
});

test("rejects missing required deploy URLs", () => {
  const errors = validateEnv({
    NEXT_PUBLIC_API_URL: "",
    NEXT_PUBLIC_APP_URL: "",
  });

  assert.equal(errors.length, 2);
  assert.match(errors[0], /NEXT_PUBLIC_API_URL is required/);
  assert.match(errors[1], /NEXT_PUBLIC_APP_URL is required/);
});

test("rejects malformed public URLs", () => {
  const errors = validateEnv({
    NEXT_PUBLIC_API_URL: "not-a-url",
    NEXT_PUBLIC_APP_URL: "still-not-a-url",
  });

  assert.equal(errors.length, 2);
  assert.match(errors[0], /must be a valid absolute URL/);
  assert.match(errors[1], /must be a valid absolute URL/);
});

test("rejects malformed Clerk publishable key", () => {
  const errors = validateEnv({
    NEXT_PUBLIC_API_URL: "https://api.hackmarket.io/v1",
    NEXT_PUBLIC_APP_URL: "https://hackmarket.io",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_test_not_publishable",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /Clerk publishable key/);
});

test("rejects Clerk publishable key with invalid encoded frontend host", () => {
  const errors = validateEnv({
    NEXT_PUBLIC_API_URL: "https://api.hackmarket.io/v1",
    NEXT_PUBLIC_APP_URL: "https://hackmarket.io",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc123",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /frontend API host/);
});

test("requires Clerk publishable key for deploy builds", () => {
  const errors = validateEnv({
    VERCEL: "1",
    NEXT_PUBLIC_API_URL: "https://api.hackmarket.io/v1",
    NEXT_PUBLIC_APP_URL: "https://hackmarket.io",
    CLERK_SECRET_KEY: "sk_test_abc123",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required/);
});

test("requires Clerk secret key for deploy builds", () => {
  const errors = validateEnv({
    VERCEL: "1",
    NEXT_PUBLIC_API_URL: "https://api.hackmarket.io/v1",
    NEXT_PUBLIC_APP_URL: "https://hackmarket.io",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5kZXYk",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /CLERK_SECRET_KEY is required/);
});

test("rejects malformed Clerk secret key", () => {
  const errors = validateEnv({
    NEXT_PUBLIC_API_URL: "https://api.hackmarket.io/v1",
    NEXT_PUBLIC_APP_URL: "https://hackmarket.io",
    CLERK_SECRET_KEY: "pk_test_not_secret",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /Clerk secret key/);
});

test("rejects public demo API key in deploy builds", () => {
  const errors = validateEnv({
    VERCEL: "1",
    NEXT_PUBLIC_API_URL: "https://api.hackmarket.io/v1",
    NEXT_PUBLIC_APP_URL: "https://hackmarket.io",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5kZXYk",
    CLERK_SECRET_KEY: "sk_test_abc123",
    NEXT_PUBLIC_DEMO_API_KEY: "hm_live_should_not_ship",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /NEXT_PUBLIC_DEMO_API_KEY must not be set/);
});
