import assert from "node:assert/strict";
import test from "node:test";

import { validateRuntimeEnv } from "./start-container.mjs";

test("requires the Clerk secret at container runtime", () => {
  assert.deepEqual(validateRuntimeEnv({ NODE_ENV: "production" }), [
    "CLERK_SECRET_KEY is required at container runtime.",
  ]);
});

test("requires a live Clerk secret in production", () => {
  assert.deepEqual(
    validateRuntimeEnv({
      NODE_ENV: "production",
      CLERK_SECRET_KEY: "sk_test_abc123",
    }),
    ["CLERK_SECRET_KEY must use a live Clerk key in production."],
  );
});

test("accepts a live Clerk secret in production", () => {
  assert.deepEqual(
    validateRuntimeEnv({
      NODE_ENV: "production",
      CLERK_SECRET_KEY: "sk_live_abc123",
    }),
    [],
  );
});
