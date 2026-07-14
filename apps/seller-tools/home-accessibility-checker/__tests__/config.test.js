const {
  getRuntimeConfig,
  parseAllowedOrigins,
  parseBooleanEnv,
  parseNumberEnv,
} = require("../config");

describe("config helpers", () => {
  const originalEnv = {
    PORT: process.env.PORT,
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
    MAX_FILES: process.env.MAX_FILES,
    MAX_INLINE_IMAGES: process.env.MAX_INLINE_IMAGES,
    TEMP_DIR: process.env.TEMP_DIR,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    OPENROUTER_TIMEOUT_MS: process.env.OPENROUTER_TIMEOUT_MS,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    MAX_LISTING_HTML_BYTES: process.env.MAX_LISTING_HTML_BYTES,
    ALLOW_UNSIGNED_GATEWAY_REQUESTS:
      process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("parseNumberEnv falls back for invalid values", () => {
    process.env.MAX_FILES = "not-a-number";
    expect(parseNumberEnv("MAX_FILES", 7)).toBe(7);

    process.env.MAX_FILES = "-2";
    expect(parseNumberEnv("MAX_FILES", 7)).toBe(7);
  });

  test("parseAllowedOrigins trims and filters comma-separated origins", () => {
    expect(
      parseAllowedOrigins(
        " https://one.example , , https://two.example  ,http://localhost:3000 ",
      ),
    ).toEqual([
      "https://one.example",
      "https://two.example",
      "http://localhost:3000",
    ]);
  });

  test("parseAllowedOrigins falls back to wildcard when unset", () => {
    expect(parseAllowedOrigins("")).toEqual(["*"]);
    expect(parseAllowedOrigins(undefined)).toEqual(["*"]);
  });

  test("parseBooleanEnv accepts explicit truthy values and defaults safely", () => {
    process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS = "yes";
    expect(parseBooleanEnv("ALLOW_UNSIGNED_GATEWAY_REQUESTS", false)).toBe(
      true,
    );

    process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS = "false";
    expect(parseBooleanEnv("ALLOW_UNSIGNED_GATEWAY_REQUESTS", true)).toBe(
      false,
    );

    delete process.env.ALLOW_UNSIGNED_GATEWAY_REQUESTS;
    expect(parseBooleanEnv("ALLOW_UNSIGNED_GATEWAY_REQUESTS", false)).toBe(
      false,
    );
  });

  test("getRuntimeConfig derives uploadDir from tempDir when uploadDir is unset", () => {
    process.env.TEMP_DIR = "/tmp/hackmarket-tests";
    delete process.env.UPLOAD_DIR;

    const config = getRuntimeConfig();

    expect(config.tempDir).toBe("/tmp/hackmarket-tests");
    expect(config.uploadDir).toBe("/tmp/hackmarket-tests/uploads");
  });

  test("getRuntimeConfig respects explicit uploadDir and inline image limit", () => {
    process.env.TEMP_DIR = "/tmp/hackmarket-tests";
    process.env.UPLOAD_DIR = "/var/uploads";
    process.env.MAX_FILES = "8";
    process.env.MAX_INLINE_IMAGES = "3";
    process.env.PUBLIC_APP_URL = "https://example.com";
    process.env.OPENROUTER_TIMEOUT_MS = "15000";
    process.env.OPENROUTER_MODEL = "openai/test-vision";
    process.env.MAX_LISTING_HTML_BYTES = "123456";

    const config = getRuntimeConfig();

    expect(config.maxFiles).toBe(8);
    expect(config.maxInlineImages).toBe(3);
    expect(config.uploadDir).toBe("/var/uploads");
    expect(config.publicAppUrl).toBe("https://example.com");
    expect(config.openrouterTimeoutMs).toBe(15000);
    expect(config.openrouterModel).toBe("openai/test-vision");
    expect(config.maxListingHtmlBytes).toBe(123456);
  });

  test("getRuntimeConfig returns a copy of allowedMimeTypes", () => {
    const first = getRuntimeConfig();
    const second = getRuntimeConfig();

    first.allowedMimeTypes.push("image/gif");

    expect(second.allowedMimeTypes).toEqual([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ]);
  });
});
