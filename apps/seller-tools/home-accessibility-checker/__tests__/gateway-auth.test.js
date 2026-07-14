const crypto = require("crypto");
const {
  SIGNATURE_HEADER,
  SIGNATURE_KEY_ID_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  SIGNATURE_VERSION,
  SIGNATURE_VERSION_HEADER,
  buildCanonicalMessage,
  createGatewayVerifier,
} = require("../services/gateway-auth");

const FIXED_PUBLIC_KEY = "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w";
const FIXED_SIGNATURE =
  "D8v-Zed1aziCR8Su2cpGTEdLBvs_1ejZ4291m3BYy7I0q43d0xqdr18EXjr08eZ1vAOWzae7cKd3rj5bHkCzDQ";

function createKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicKey: publicDer.subarray(publicDer.length - 32).toString("base64url"),
  };
}

function createSignedRequest({
  privateKey,
  method = "POST",
  requestTarget = "/api/analyze?mode=full%20scan",
  timestamp = 1_800_000_000,
  requestId = "req_123",
  toolSlug = "home-accessibility-checker",
  keyId = "launch-1",
} = {}) {
  const message = buildCanonicalMessage({
    method,
    requestTarget,
    timestamp,
    requestId,
    toolSlug,
    keyId,
  });
  const headers = {
    [SIGNATURE_VERSION_HEADER.toLowerCase()]: SIGNATURE_VERSION,
    [SIGNATURE_KEY_ID_HEADER.toLowerCase()]: keyId,
    [SIGNATURE_TIMESTAMP_HEADER.toLowerCase()]: String(timestamp),
    [SIGNATURE_HEADER.toLowerCase()]: crypto
      .sign(null, message, privateKey)
      .toString("base64url"),
    "x-hackmarket-request-id": requestId,
    "x-hackmarket-tool-slug": toolSlug,
  };

  return {
    method,
    originalUrl: requestTarget,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

function createVerifier(publicKey, overrides = {}) {
  return createGatewayVerifier({
    publicKey,
    keyId: "launch-1",
    expectedToolSlug: "home-accessibility-checker",
    maxAgeSeconds: 300,
    nowSeconds: () => 1_800_000_000,
    ...overrides,
  });
}

describe("gateway request authentication", () => {
  test("accepts the API cross-runtime signature vector", () => {
    const headers = {
      [SIGNATURE_VERSION_HEADER.toLowerCase()]: SIGNATURE_VERSION,
      [SIGNATURE_KEY_ID_HEADER.toLowerCase()]: "launch-1",
      [SIGNATURE_TIMESTAMP_HEADER.toLowerCase()]: "1800000000",
      [SIGNATURE_HEADER.toLowerCase()]: FIXED_SIGNATURE,
      "x-hackmarket-request-id": "req_cross_language",
      "x-hackmarket-tool-slug": "home-accessibility-checker",
    };
    const request = {
      method: "POST",
      originalUrl: "/api/analyze?mode=full%20scan",
      get(name) {
        return headers[name.toLowerCase()];
      },
    };

    expect(createVerifier(FIXED_PUBLIC_KEY).verifyRequest(request)).toEqual({
      ok: true,
      unsigned: false,
    });
  });

  test("accepts a valid request bound to the method, target, and tool", () => {
    const keys = createKeyPair();
    const verifier = createVerifier(keys.publicKey);

    const result = verifier.verifyRequest(
      createSignedRequest({ privateKey: keys.privateKey }),
    );

    expect(result).toEqual({ ok: true, unsigned: false });
  });

  test("rejects missing or forged signatures", () => {
    const keys = createKeyPair();
    const verifier = createVerifier(keys.publicKey);
    const unsigned = {
      method: "POST",
      originalUrl: "/api/analyze",
      get: () => undefined,
    };

    expect(verifier.verifyRequest(unsigned)).toMatchObject({
      ok: false,
      statusCode: 401,
      code: "INVALID_GATEWAY_SIGNATURE",
    });

    const altered = createSignedRequest({ privateKey: keys.privateKey });
    altered.originalUrl = "/api/scrape";
    expect(verifier.verifyRequest(altered)).toMatchObject({
      ok: false,
      code: "INVALID_GATEWAY_SIGNATURE",
    });
  });

  test("rejects signatures for another tool or key id", () => {
    const keys = createKeyPair();
    const verifier = createVerifier(keys.publicKey);

    expect(
      verifier.verifyRequest(
        createSignedRequest({
          privateKey: keys.privateKey,
          toolSlug: "another-tool",
        }),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_GATEWAY_SIGNATURE" });

    expect(
      verifier.verifyRequest(
        createSignedRequest({
          privateKey: keys.privateKey,
          keyId: "old-key",
        }),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_GATEWAY_SIGNATURE" });
  });

  test("rejects stale and future-dated signatures", () => {
    const keys = createKeyPair();
    const verifier = createVerifier(keys.publicKey);

    for (const timestamp of [1_799_999_699, 1_800_000_301]) {
      expect(
        verifier.verifyRequest(
          createSignedRequest({ privateKey: keys.privateKey, timestamp }),
        ),
      ).toMatchObject({
        ok: false,
        statusCode: 401,
        code: "GATEWAY_SIGNATURE_EXPIRED",
      });
    }
  });

  test("rejects a replayed request id after successful verification", () => {
    const keys = createKeyPair();
    const verifier = createVerifier(keys.publicKey);
    const first = createSignedRequest({ privateKey: keys.privateKey });
    const replay = createSignedRequest({ privateKey: keys.privateKey });

    expect(verifier.verifyRequest(first).ok).toBe(true);
    expect(verifier.verifyRequest(replay)).toMatchObject({
      ok: false,
      statusCode: 409,
      code: "GATEWAY_REQUEST_REPLAYED",
    });
  });

  test("fails closed for invalid configuration unless test bypass is explicit", () => {
    const verifier = createVerifier("invalid-key");
    const request = { method: "POST", originalUrl: "/", get: () => undefined };

    expect(verifier.ready).toBe(false);
    expect(verifier.verifyRequest(request)).toMatchObject({
      ok: false,
      statusCode: 503,
      code: "GATEWAY_AUTH_NOT_CONFIGURED",
    });

    const bypass = createVerifier("", { allowUnsigned: true });
    expect(bypass.ready).toBe(true);
    expect(bypass.verifyRequest(request)).toEqual({ ok: true, unsigned: true });
  });
});
