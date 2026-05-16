const ImageService = require("../services/image-service");

describe("ImageService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.REMOTE_IMAGE_FETCH_TIMEOUT_MS;
    delete process.env.MAX_REMOTE_IMAGE_BYTES;
  });

  test("returns a payload for a fetched remote image", async () => {
    const service = new ImageService();
    jest
      .spyOn(service, "optimizeBuffer")
      .mockResolvedValue(Buffer.from("optimized"));
    jest.spyOn(service, "bufferToBase64").mockResolvedValue("b3B0aW1pemVk");

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name) => {
          if (name === "content-length") return "9";
          if (name === "content-type") return "image/webp";
          return null;
        },
      },
      arrayBuffer: async () => Buffer.from("original"),
    });

    const payload = await service.fetchImageAsPayload(
      "https://example.com/image.webp",
      2,
    );

    expect(payload).toEqual({
      filename: "scraped_image_3.jpg",
      base64: "b3B0aW1pemVk",
      size: Buffer.from("optimized").length,
      mimetype: "image/webp",
    });
  });

  test("rejects remote images that exceed the configured size limit", async () => {
    process.env.MAX_REMOTE_IMAGE_BYTES = "5";
    const service = new ImageService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name) => (name === "content-length" ? "6" : "image/jpeg"),
      },
    });

    await expect(
      service.fetchImageAsPayload("https://example.com/image.jpg"),
    ).rejects.toThrow(
      "Remote image fetch failed: Remote image exceeds size limit (6 bytes)",
    );
  });

  test("wraps remote image fetch timeouts with a clear message", async () => {
    process.env.REMOTE_IMAGE_FETCH_TIMEOUT_MS = "2222";
    const service = new ImageService();
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("timed out"), { name: "AbortError" }),
      );

    await expect(
      service.fetchImageAsPayload("https://example.com/image.jpg"),
    ).rejects.toThrow("Remote image fetch timed out after 2222ms");
  });
});
