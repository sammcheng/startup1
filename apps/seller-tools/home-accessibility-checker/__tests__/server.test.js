const request = require("supertest");
const sharp = require("sharp");
const crypto = require("crypto");
const { createApp } = require("../server");
const {
  SIGNATURE_HEADER,
  SIGNATURE_KEY_ID_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  SIGNATURE_VERSION,
  SIGNATURE_VERSION_HEADER,
  buildCanonicalMessage,
} = require("../services/gateway-auth");

function createGatewayKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicKey: publicDer.subarray(publicDer.length - 32).toString("base64url"),
  };
}

function createGatewayHeaders(privateKey, requestTarget = "/") {
  const timestamp = Math.floor(Date.now() / 1000);
  const requestId = `req-${crypto.randomUUID()}`;
  const toolSlug = "home-accessibility-checker";
  const keyId = "launch-1";
  const message = buildCanonicalMessage({
    method: "POST",
    requestTarget,
    timestamp,
    requestId,
    toolSlug,
    keyId,
  });
  return {
    [SIGNATURE_VERSION_HEADER]: SIGNATURE_VERSION,
    [SIGNATURE_KEY_ID_HEADER]: keyId,
    [SIGNATURE_TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: crypto
      .sign(null, message, privateKey)
      .toString("base64url"),
    "X-HackMarket-Request-Id": requestId,
    "X-HackMarket-Tool-Slug": toolSlug,
  };
}

describe("seller tool server", () => {
  let app;
  const originalFetch = global.fetch;
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
  const originalRateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS;
  const originalRateLimitWindowMs = process.env.RATE_LIMIT_WINDOW_MS;
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  const originalGatewayPublicKey = process.env.HACKMARKET_GATEWAY_PUBLIC_KEY;
  const originalGatewayKeyId = process.env.HACKMARKET_GATEWAY_KEY_ID;
  const originalGatewayToolSlug = process.env.HACKMARKET_TOOL_SLUG;
  const originalAllowUnsignedGatewayRequests =
    process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS;

  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.HACKMARKET_GATEWAY_PUBLIC_KEY;
    delete process.env.HACKMARKET_GATEWAY_KEY_ID;
    delete process.env.HACKMARKET_TOOL_SLUG;
    delete process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS;
    app = createApp();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
    if (originalRateLimitMaxRequests === undefined) {
      delete process.env.RATE_LIMIT_MAX_REQUESTS;
    } else {
      process.env.RATE_LIMIT_MAX_REQUESTS = originalRateLimitMaxRequests;
    }
    if (originalRateLimitWindowMs === undefined) {
      delete process.env.RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.RATE_LIMIT_WINDOW_MS = originalRateLimitWindowMs;
    }
    if (originalOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    }
    for (const [key, value] of Object.entries({
      HACKMARKET_GATEWAY_PUBLIC_KEY: originalGatewayPublicKey,
      HACKMARKET_GATEWAY_KEY_ID: originalGatewayKeyId,
      HACKMARKET_TOOL_SLUG: originalGatewayToolSlug,
      ALLOW_UNSIGNED_GATEWAY_REQUESTS: originalAllowUnsignedGatewayRequests,
    })) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("GET /health returns healthy payload", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("healthy");
    expect(typeof response.body.timestamp).toBe("string");
    expect(typeof response.body.uptime).toBe("number");
    expect(response.headers["x-hackmarket-request-id"]).toBeTruthy();
    expect(
      Number(response.headers["x-hackmarket-response-time-ms"]),
    ).toBeGreaterThanOrEqual(1);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("GET /health preserves a caller-provided request id", async () => {
    const response = await request(app)
      .get("/health")
      .set("X-HackMarket-Request-Id", "req-test-123");

    expect(response.status).toBe(200);
    expect(response.headers["x-hackmarket-request-id"]).toBe("req-test-123");
  });

  test("GET /ready fails when the analysis provider is not configured", async () => {
    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "not_ready",
      checks: {
        analysis_provider: {
          configured: false,
        },
        gateway_authentication: {
          configured: false,
          enforced: false,
        },
      },
      timestamp: expect.any(String),
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("GET /ready succeeds when the analysis provider is configured", async () => {
    process.env.OPENROUTER_API_KEY = "configured-test-key";

    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.checks.analysis_provider.configured).toBe(true);
    expect(response.body.checks.gateway_authentication).toEqual({
      configured: false,
      enforced: false,
    });
  });

  test("production-style API routes fail closed when gateway auth is missing", async () => {
    process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS = "false";
    app = createApp();

    const response = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send("{not-valid-json");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Gateway authentication is not configured.",
      code: "GATEWAY_AUTH_NOT_CONFIGURED",
      requestId: expect.any(String),
    });
  });

  test("signed gateway requests reach the protected root route", async () => {
    const keys = createGatewayKeyPair();
    process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS = "false";
    process.env.HACKMARKET_GATEWAY_PUBLIC_KEY = keys.publicKey;
    process.env.HACKMARKET_GATEWAY_KEY_ID = "launch-1";
    process.env.HACKMARKET_TOOL_SLUG = "home-accessibility-checker";
    app = createApp();

    const response = await request(app)
      .post("/")
      .set(createGatewayHeaders(keys.privateKey))
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  test("unsigned requests are rejected when gateway auth is configured", async () => {
    const keys = createGatewayKeyPair();
    process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS = "false";
    process.env.HACKMARKET_GATEWAY_PUBLIC_KEY = keys.publicKey;
    process.env.HACKMARKET_GATEWAY_KEY_ID = "launch-1";
    process.env.HACKMARKET_TOOL_SLUG = "home-accessibility-checker";
    app = createApp();

    const response = await request(app).post("/").send({});

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("INVALID_GATEWAY_SIGNATURE");
  });

  test("GET /health allows arbitrary origins without credentials when wildcard CORS is used", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "https://random.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://random.example",
    );
    expect(
      response.headers["access-control-allow-credentials"],
    ).toBeUndefined();
    expect(response.headers.vary).toContain("Origin");
  });

  test("GET /health reflects allowed origins and credentials when CORS is restricted", async () => {
    process.env.ALLOWED_ORIGINS = "https://app.example,https://admin.example";
    app = createApp();

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://app.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://app.example",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers.vary).toContain("Origin");
  });

  test("GET /health rejects disallowed origins with a structured 403", async () => {
    process.env.ALLOWED_ORIGINS = "https://app.example,https://admin.example";
    app = createApp();

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://nope.example");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Origin not allowed",
      message:
        "This origin is not allowed to access the accessibility checker.",
      requestId: expect.any(String),
    });
    expect(response.headers["x-hackmarket-request-id"]).toBeTruthy();
  });

  test("OPTIONS preflight succeeds for allowed restricted origins", async () => {
    process.env.ALLOWED_ORIGINS = "https://app.example,https://admin.example";
    app = createApp();

    const response = await request(app)
      .options("/api/analyze")
      .set("Origin", "https://admin.example")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://admin.example",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("OPTIONS preflight rejects disallowed restricted origins", async () => {
    process.env.ALLOWED_ORIGINS = "https://app.example,https://admin.example";
    app = createApp();

    const response = await request(app)
      .options("/api/analyze")
      .set("Origin", "https://blocked.example")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Origin not allowed",
      message:
        "This origin is not allowed to access the accessibility checker.",
      requestId: expect.any(String),
    });
    expect(response.headers["x-hackmarket-request-id"]).toBeTruthy();
  });

  test("POST /api/analyze rejects empty payload", async () => {
    const response = await request(app).post("/api/analyze").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
    expect(response.body.requestId).toBeTruthy();
    expect(Array.isArray(response.body.details)).toBe(true);
  });

  test("POST / rejects empty payload for gateway compatibility", async () => {
    const response = await request(app).post("/").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
    expect(response.body.requestId).toBeTruthy();
    expect(Array.isArray(response.body.details)).toBe(true);
  });

  test("POST / rejects bytes that are not a real image", async () => {
    const response = await request(app)
      .post("/")
      .send({
        images: [
          {
            filename: "not-an-image.jpg",
            base64: "A".repeat(120),
            mimetype: "image/jpeg",
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid image data",
      message: 'The file "not-an-image.jpg" is not a valid supported image.',
      requestId: expect.any(String),
    });
  });

  test("POST / returns an honest 503 when the provider key is missing", async () => {
    const jpeg = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .jpeg()
      .toBuffer();

    const response = await request(app)
      .post("/")
      .send({
        images: [
          {
            filename: "entry.jpg",
            base64: jpeg.toString("base64"),
            mimetype: "image/jpeg",
          },
        ],
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Analysis service unavailable",
      message:
        "Image analysis is not configured right now. Please try again later.",
      code: "ANALYSIS_PROVIDER_NOT_CONFIGURED",
      retryable: false,
      requestId: expect.any(String),
    });
    expect(response.headers["retry-after"]).toBeUndefined();
  });

  test("POST /api/scrape rejects unsupported urls", async () => {
    const response = await request(app)
      .post("/api/scrape")
      .send({ url: "https://example.com/listing/123" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
    expect(response.body.requestId).toBeTruthy();
    expect(Array.isArray(response.body.details)).toBe(true);
  });

  test("POST /api/scrape preserves retryable upstream errors from listing fetches", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    const response = await request(app)
      .post("/api/scrape")
      .send({ url: "https://www.zillow.com/homedetails/123-main-st" });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "Listing fetch failed",
      message:
        "This listing site blocked automated access. Try uploading photos directly instead.",
      requestId: expect.any(String),
    });
  });

  test("POST /api/upload-and-analyze requires at least one image", async () => {
    const response = await request(app).post("/api/upload-and-analyze");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "No images provided",
      message: "Please upload at least one image",
      requestId: expect.any(String),
    });
  });

  test("POST /api/upload-and-analyze enforces the configured file-count limit", async () => {
    const response = await request(app)
      .post("/api/upload-and-analyze")
      .attach("images", Buffer.from("a"), {
        filename: "1.png",
        contentType: "image/png",
      })
      .attach("images", Buffer.from("b"), {
        filename: "2.png",
        contentType: "image/png",
      })
      .attach("images", Buffer.from("c"), {
        filename: "3.png",
        contentType: "image/png",
      })
      .attach("images", Buffer.from("d"), {
        filename: "4.png",
        contentType: "image/png",
      })
      .attach("images", Buffer.from("e"), {
        filename: "5.png",
        contentType: "image/png",
      })
      .attach("images", Buffer.from("f"), {
        filename: "6.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Too many files",
      message: "Maximum 5 files allowed",
      requestId: expect.any(String),
    });
  });

  test("unknown routes return structured 404 responses", async () => {
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Not found",
      message: "The requested endpoint does not exist",
      requestId: expect.any(String),
    });
    expect(response.headers["x-hackmarket-request-id"]).toBeTruthy();
  });

  test("API rate limiting returns a structured 429 with requestId", async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "1";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    app = createApp();

    const first = await request(app).get("/api/does-not-exist");
    const second = await request(app).get("/api/does-not-exist");

    expect(first.status).toBe(404);
    expect(second.status).toBe(429);
    expect(second.body).toEqual({
      error: "Too many requests from this IP, please try again later.",
      retryAfter: "1 minute",
      requestId: expect.any(String),
    });
    expect(second.headers["x-hackmarket-request-id"]).toBeTruthy();
    expect(second.headers["retry-after"]).toBe("60");
  });

  test("API rate limiting rounds retryAfter up to plural minutes when needed", async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "1";
    process.env.RATE_LIMIT_WINDOW_MS = "61000";
    app = createApp();

    await request(app).get("/api/does-not-exist");
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(429);
    expect(response.body.retryAfter).toBe("2 minutes");
    expect(response.headers["retry-after"]).toBe("61");
  });

  test("root gateway endpoint is rate limited too", async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "1";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    app = createApp();

    const first = await request(app).post("/").send({});
    const second = await request(app).post("/").send({});

    expect(first.status).toBe(400);
    expect(second.status).toBe(429);
    expect(second.body).toEqual({
      error: "Too many requests from this IP, please try again later.",
      retryAfter: "1 minute",
      requestId: expect.any(String),
    });
    expect(second.headers["retry-after"]).toBe("60");
  });
});
