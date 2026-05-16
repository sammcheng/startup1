describe("createLogger", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };

  afterEach(() => {
    jest.resetModules();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("silences log output when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const { createLogger } = require("../logger");

    const logger = createLogger({ service: "test-service" });

    expect(logger.silent).toBe(true);
  });

  test("uses configured log level outside test mode", () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL = "debug";
    const { createLogger } = require("../logger");

    const logger = createLogger({ service: "dev-service" });

    expect(logger.silent).toBe(false);
    expect(logger.level).toBe("debug");
    expect(logger.defaultMeta).toEqual({ service: "dev-service" });
  });
});
