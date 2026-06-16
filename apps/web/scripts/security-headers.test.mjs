import test from "node:test";
import assert from "node:assert/strict";

import { buildContentSecurityPolicy, buildSecurityHeaders } from "../security-headers.mjs";

test("buildContentSecurityPolicy includes required third-party origins", () => {
  const csp = buildContentSecurityPolicy({
    appUrl: "https://hackmarket.io",
    apiUrl: "https://api.hackmarket.io/v1",
    converterUrl: "https://converter.hackmarket.io",
    nodeEnv: "production",
  });

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.hackmarket\.io/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.clerk\.com/);
  assert.match(csp, /frame-src[^;]*https:\/\/checkout\.stripe\.com/);
  assert.match(csp, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /upgrade-insecure-requests/);
});

test("buildContentSecurityPolicy keeps unsafe-eval out of production", () => {
  const csp = buildContentSecurityPolicy({ nodeEnv: "production" });

  assert.doesNotMatch(csp, /unsafe-eval/);
});

test("buildSecurityHeaders adds strict transport security only in production", () => {
  const devHeaders = buildSecurityHeaders({ nodeEnv: "development" });
  const prodHeaders = buildSecurityHeaders({ nodeEnv: "production" });

  assert.equal(devHeaders.some((header) => header.key === "Strict-Transport-Security"), false);
  assert.equal(prodHeaders.some((header) => header.key === "Strict-Transport-Security"), true);
  assert.equal(prodHeaders.some((header) => header.key === "Content-Security-Policy"), true);
});
