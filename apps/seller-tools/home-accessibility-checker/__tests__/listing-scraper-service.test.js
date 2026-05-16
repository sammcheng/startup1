const ListingScraperService = require("../services/listing-scraper-service");

describe("ListingScraperService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.LISTING_FETCH_TIMEOUT_MS;
  });

  test("wraps fetch timeouts with a user-friendly gateway error", async () => {
    process.env.LISTING_FETCH_TIMEOUT_MS = "3210";
    const service = new ListingScraperService();
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      );

    await expect(
      service.fetchListingHtml("https://example.com/listing"),
    ).rejects.toMatchObject({
      message: "Listing page fetch timed out after 3210ms",
      statusCode: 502,
      publicError: "Listing fetch failed",
      userMessage:
        "The listing site took too long to respond. Try again or upload photos directly instead.",
    });
  });

  test("maps blocked listing pages to a retryable upstream error", async () => {
    const service = new ListingScraperService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    await expect(
      service.fetchListingHtml("https://example.com/listing"),
    ).rejects.toMatchObject({
      message: "Listing page fetch failed with status 403",
      statusCode: 502,
      publicError: "Listing fetch failed",
      userMessage:
        "This listing site blocked automated access. Try uploading photos directly instead.",
    });
  });

  test("extracts listing images and property metadata from HTML", async () => {
    const service = new ListingScraperService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "House",
                "address": {
                  "streetAddress": "123 Main St",
                  "addressLocality": "Portland",
                  "addressRegion": "OR",
                  "postalCode": "97201"
                },
                "numberOfBedrooms": 3,
                "numberOfBathroomsTotal": 2,
                "floorSize": {"value": 1800},
                "price": 650000
              }
            </script>
          </head>
          <body>
            <img src="https://photos.zillowstatic.com/fp/one.jpg" />
            <img src="https://photos.zillowstatic.com/fp/two.jpg" />
          </body>
        </html>
      `,
    });

    const result = await service.scrape(
      "https://www.zillow.com/homedetails/abc",
      5,
    );

    expect(result.images).toHaveLength(2);
    expect(result.images[0].url).toBe(
      "https://photos.zillowstatic.com/fp/one.jpg",
    );
    expect(result.propertyDetails).toMatchObject({
      address: "123 Main St, Portland, OR, 97201",
      city: "Portland",
      state: "OR",
      bedrooms: "3",
      bathrooms: "2",
      squareFeet: "1800",
      price: "650000",
    });
  });

  test("extractImageUrls normalizes escaped URLs, deduplicates, and honors maxImages", () => {
    const service = new ListingScraperService();

    const urls = service.extractImageUrls(
      `
        <img src="https://photos.zillowstatic.com/fp/one.jpg" />
        <img src="https://photos.zillowstatic.com/fp/one.jpg" />
        <img src="https:\\u002F\\u002Fphotos.zillowstatic.com\\u002Ffp\\u002Ftwo.jpg" />
        <img src="https://photos.zillowstatic.com/fp/three.jpg" />
      `,
      2,
    );

    expect(urls).toEqual([
      "https://photos.zillowstatic.com/fp/one.jpg",
      "https://photos.zillowstatic.com/fp/two.jpg",
    ]);
  });

  test("buildFallbackDetails handles invalid URLs safely", () => {
    const service = new ListingScraperService();

    expect(service.buildFallbackDetails("not-a-url")).toEqual({
      address: "Property from listing URL",
      city: "Unknown",
      state: "Unknown",
      zipCode: "Unknown",
      propertyType: "Property",
      bedrooms: "N/A",
      bathrooms: "N/A",
      squareFeet: "N/A",
      yearBuilt: "N/A",
      lotSize: "N/A",
      price: "N/A",
    });
  });
});
