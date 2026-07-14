const OpenRouterService = require("../services/openrouter-service");

describe("OpenRouterService", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_MODEL = "openai/test-vision";
  });

  afterEach(() => {
    restoreEnv("OPENROUTER_API_KEY", originalApiKey);
    restoreEnv("OPENROUTER_MODEL", originalModel);
  });

  test("parseAnalysisResponse extracts structured provider JSON", () => {
    const service = new OpenRouterService();
    const result = service.parseAnalysisResponse(
      `Here is the analysis:
      {
        "score": 82,
        "positive_features": ["Wide doorway"],
        "barriers": ["High threshold"],
        "safety_concerns": ["Loose rug"],
        "recommendations": ["Assess a threshold ramp"],
        "accessibility_rating": "Good",
        "priority_improvements": ["Measure the threshold"],
        "limitations": ["Dimensions require in-person measurement"]
      }`,
      "entry.jpg",
    );

    expect(result).toEqual({
      filename: "entry.jpg",
      score: 82,
      positive_features: ["Wide doorway"],
      barriers: ["High threshold"],
      safety_concerns: ["Loose rug"],
      recommendations: ["Assess a threshold ramp"],
      accessibility_rating: "Good",
      priority_improvements: ["Measure the threshold"],
      limitations: ["Dimensions require in-person measurement"],
    });
  });

  test("parseAnalysisResponse accepts provider text only when it has real findings and a score", () => {
    const service = new OpenRouterService();
    const result = service.parseAnalysisResponse(
      [
        "Accessibility score: 71",
        "Positive features: Wide doorway near the entrance, Clear pathway through the kitchen",
        "Barriers: High threshold at the patio door",
        "Recommendations: Measure the threshold and assess a transition ramp",
      ].join("\n"),
      "kitchen.jpg",
    );

    expect(result.score).toBe(71);
    expect(result.positive_features).toContain(
      "Wide doorway near the entrance",
    );
    expect(result.barriers).toContain("High threshold at the patio door");
    expect(result.recommendations).toContain(
      "Measure the threshold and assess a transition ramp",
    );
  });

  test("parseAnalysisResponse rejects malformed provider output instead of inventing a score", () => {
    const service = new OpenRouterService();

    expect(() =>
      service.parseAnalysisResponse(
        "No structured findings available.",
        "bad.jpg",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "ANALYSIS_PROVIDER_INVALID_RESPONSE",
        statusCode: 502,
      }),
    );
  });

  test("analyzeAccessibility rejects a missing key instead of returning synthetic findings", async () => {
    const service = new OpenRouterService();

    await expect(
      service.analyzeAccessibility("abc123", "hallway.jpg"),
    ).rejects.toMatchObject({
      code: "ANALYSIS_PROVIDER_NOT_CONFIGURED",
      statusCode: 503,
      retryable: false,
    });
    expect(service.generateDynamicAnalysis).toBeUndefined();
  });

  test("analyzeAccessibility returns provider-backed metadata with measured duration", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const service = new OpenRouterService();
    service.openaiClient = createClientWithContent(
      JSON.stringify({
        score: 76,
        positive_features: ["Clear route"],
        barriers: [],
        safety_concerns: [],
        recommendations: ["Verify doorway clearance in person"],
        limitations: ["No scale reference is visible"],
      }),
    );

    const result = await service.analyzeAccessibility(
      "abc123",
      "entry.webp",
      "image/webp",
    );

    expect(result).toMatchObject({
      score: 76,
      metadata: {
        filename: "entry.webp",
        model_used: "openai/test-vision",
        processing_time_ms: expect.any(Number),
        timestamp: expect.any(String),
      },
    });
    const request =
      service.openaiClient.chat.completions.create.mock.calls[0][0];
    const requestOptions =
      service.openaiClient.chat.completions.create.mock.calls[0][1];
    expect(request.messages[0].content[1].image_url.url).toBe(
      "data:image/webp;base64,abc123",
    );
    expect(requestOptions).toEqual({ timeout: 20000, maxRetries: 1 });
  });

  test("analyzeAccessibility preserves provider failures as retryable errors", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const service = new OpenRouterService();
    service.openaiClient = {
      chat: {
        completions: {
          create: jest
            .fn()
            .mockRejectedValue(new Error("upstream unavailable")),
        },
      },
    };

    await expect(
      service.analyzeAccessibility("abc123", "entry.jpg"),
    ).rejects.toMatchObject({
      code: "ANALYSIS_PROVIDER_UNAVAILABLE",
      statusCode: 503,
      retryable: true,
    });
  });
});

function createClientWithContent(content) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
