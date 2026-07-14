const ValidationService = require("../services/validation-service");

describe("ValidationService", () => {
  const originalEnv = {
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
    MAX_FILES: process.env.MAX_FILES,
    MAX_INLINE_IMAGES: process.env.MAX_INLINE_IMAGES,
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

  test("validateUploadRequest respects env-driven file count and file size limits", () => {
    process.env.MAX_FILE_SIZE = "5";
    process.env.MAX_FILES = "2";
    const service = new ValidationService();

    const result = service.validateUploadRequest({
      images: [
        { filename: "one.jpg", size: 4, mimetype: "image/jpeg" },
        { filename: "two.jpg", size: 4, mimetype: "image/jpeg" },
        { filename: "three.jpg", size: 4, mimetype: "image/jpeg" },
      ],
    });

    expect(result.error).toBeTruthy();
    expect(
      result.error.details.some((detail) => detail.type === "array.max"),
    ).toBe(true);
  });

  test("validateAnalyzeRequest respects env-driven inline image limits", () => {
    process.env.MAX_INLINE_IMAGES = "1";
    const service = new ValidationService();
    const sampleBase64 = "A".repeat(120);

    const result = service.validateAnalyzeRequest({
      images: [
        {
          filename: "one.jpg",
          base64: sampleBase64,
          size: 2,
          mimetype: "image/jpeg",
        },
        {
          filename: "two.jpg",
          base64: sampleBase64,
          size: 2,
          mimetype: "image/jpeg",
        },
      ],
    });

    expect(result.error).toBeTruthy();
    expect(
      result.error.details.some((detail) => detail.type === "array.max"),
    ).toBe(true);
  });

  test("caps remote listing analysis at the configured file limit", () => {
    process.env.MAX_FILES = "2";
    const service = new ValidationService();

    expect(
      service.validateAnalyzeRequest({
        url: "https://www.zillow.com/homedetails/123",
        maxImages: 3,
      }).error,
    ).toBeTruthy();
    expect(
      service.validateAnalyzeRequest({
        url: "https://www.zillow.com/homedetails/123",
      }).value.maxImages,
    ).toBe(2);
  });

  test("listing URLs require HTTPS on an exact supported host", () => {
    const service = new ValidationService();

    expect(
      service.validateAnalyzeRequest({
        url: "https://www.zillow.com/homedetails/123-main-st",
      }).error,
    ).toBeNull();
    for (const url of [
      "http://www.zillow.com/homedetails/123-main-st",
      "https://zillow.com.attacker.example/listing",
      "https://attacker.example/?next=zillow.com",
      "https://127.0.0.1/zillow.com",
    ]) {
      expect(service.validateAnalyzeRequest({ url }).error).toBeTruthy();
    }
  });

  test("validateBase64Image uses the configured file size ceiling", () => {
    process.env.MAX_FILE_SIZE = "6";
    const service = new ValidationService();

    expect(service.validateBase64Image("A".repeat(8))).toBe(true);
    expect(service.validateBase64Image("A".repeat(12))).toBe(false);
  });

  test("sanitizeFilename strips path traversal and unsafe characters", () => {
    const service = new ValidationService();

    expect(service.sanitizeFilename("../my weird file?.png")).toBe(
      "_my_weird_file_.png",
    );
  });

  test("validateFileSize and validateMimeType enforce runtime rules", () => {
    process.env.MAX_FILE_SIZE = "5";
    const service = new ValidationService();

    expect(service.validateFileSize(5)).toBe(true);
    expect(service.validateFileSize(6)).toBe(false);
    expect(service.validateMimeType("image/png")).toBe(true);
    expect(service.validateMimeType("application/pdf")).toBe(false);
  });

  test("createErrorResponse formats joi errors consistently", () => {
    const service = new ValidationService();
    const validationResult = service.validateAnalyzeRequest({});

    const errorResponse = service.createErrorResponse(
      validationResult,
      "Custom validation message",
    );

    expect(errorResponse).toEqual({
      error: "Validation failed",
      message: "Custom validation message",
      details: expect.arrayContaining([
        expect.objectContaining({
          field: expect.any(String),
          message: expect.any(String),
        }),
      ]),
      timestamp: expect.any(String),
    });
  });
});
