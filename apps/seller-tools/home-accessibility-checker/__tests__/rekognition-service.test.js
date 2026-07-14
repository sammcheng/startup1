const OpenRouterVisionService = require("../services/rekognition-service");

describe("OpenRouterVisionService", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  });

  test("parseAnalysisResponse extracts structured JSON wrapped in markdown", () => {
    const service = new OpenRouterVisionService();
    const result = service.parseAnalysisResponse(`\`\`\`json
      {
        "score": 77,
        "accessibility_features": ["Clear pathway"],
        "barriers": ["Raised threshold"],
        "safety_concerns": ["Loose mat"],
        "recommendations": ["Secure the mat"],
        "limitations": ["Threshold height cannot be measured from the photo"]
      }
      \`\`\``);

    expect(result).toEqual({
      score: 77,
      accessibility_features: ["Clear pathway"],
      barriers: ["Raised threshold"],
      safety_concerns: ["Loose mat"],
      recommendations: ["Secure the mat"],
      limitations: ["Threshold height cannot be measured from the photo"],
    });
  });

  test("parseTextResponse extracts provider text without defaulting missing data", () => {
    const service = new OpenRouterVisionService();
    const result = service.parseTextResponse(
      [
        "Accessibility score: 77",
        "Features: Wide doorway, Good lighting",
        "Barriers: High threshold",
        "Recommendations: Measure the threshold",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      score: 77,
      accessibility_features: ["Wide doorway", "Good lighting"],
      barriers: ["High threshold"],
      recommendations: ["Measure the threshold"],
    });
  });

  test("parseTextResponse rejects output without a provider score", () => {
    const service = new OpenRouterVisionService();
    expect(() => service.parseTextResponse("Features: Clear path")).toThrow(
      expect.objectContaining({
        code: "ANALYSIS_PROVIDER_INVALID_RESPONSE",
      }),
    );
  });

  test("analyzeAccessibility rejects a missing key without a synthetic fallback", async () => {
    const service = new OpenRouterVisionService();

    await expect(
      service.analyzeAccessibility("abc123", "hallway.jpg"),
    ).rejects.toMatchObject({
      code: "ANALYSIS_PROVIDER_NOT_CONFIGURED",
      statusCode: 503,
      retryable: false,
    });
    expect(service.generateDynamicAnalysis).toBeUndefined();
  });

  test("analyzeAccessibility rejects malformed upstream responses", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const service = new OpenRouterVisionService();
    service.openaiClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              { message: { content: "I could not inspect the image." } },
            ],
          }),
        },
      },
    };

    await expect(
      service.analyzeAccessibility("abc123", "hallway.jpg"),
    ).rejects.toMatchObject({
      code: "ANALYSIS_PROVIDER_INVALID_RESPONSE",
      statusCode: 502,
    });
  });

  test("uses an aborting SDK timeout instead of leaving provider requests running", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const service = new OpenRouterVisionService();
    service.openaiClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 75,
                    accessibility_features: ["Clear path"],
                    barriers: [],
                    safety_concerns: [],
                    recommendations: ["Verify clearances in person"],
                    limitations: ["No scale reference"],
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    await service.analyzeAccessibility("abc123", "hallway.jpg");

    expect(
      service.openaiClient.chat.completions.create.mock.calls[0][1],
    ).toEqual({ timeout: 20000, maxRetries: 1 });
  });
});
