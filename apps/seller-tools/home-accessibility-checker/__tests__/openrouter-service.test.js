const OpenRouterService = require("../services/openrouter-service");

describe("OpenRouterService", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  });

  test("parseAnalysisResponse extracts structured JSON when available", () => {
    const service = new OpenRouterService();

    const result = service.parseAnalysisResponse(
      `Here is the analysis:
      {
        "score": 82,
        "positive_features": ["Wide doorway"],
        "barriers": ["High threshold"],
        "safety_concerns": ["Loose rug"],
        "recommendations": ["Install a threshold ramp"],
        "accessibility_rating": "Good",
        "priority_improvements": ["Install a threshold ramp"]
      }`,
      "entry.jpg",
    );

    expect(result).toEqual({
      filename: "entry.jpg",
      score: 82,
      positive_features: ["Wide doorway"],
      barriers: ["High threshold"],
      safety_concerns: ["Loose rug"],
      recommendations: ["Install a threshold ramp"],
      accessibility_rating: "Good",
      priority_improvements: ["Install a threshold ramp"],
      raw_analysis: expect.any(String),
    });
  });

  test("parseAnalysisResponse falls back to keyword parsing when JSON is unavailable", () => {
    const service = new OpenRouterService();

    const result = service.parseAnalysisResponse(
      [
        "Accessibility score: 71",
        "Positive features: Wide doorway near the entrance, Clear pathway through the kitchen",
        "Barriers: High threshold at the patio door",
        "Recommendations: Install a small threshold ramp",
      ].join("\n"),
      "kitchen.jpg",
    );

    expect(result.filename).toBe("kitchen.jpg");
    expect(result.score).toBe(71);
    expect(result.positive_features).toContain(
      "Wide doorway near the entrance",
    );
    expect(result.barriers).toContain("High threshold at the patio door");
    expect(result.recommendations).toContain("Install a small threshold ramp");
    expect(result.accessibility_rating).toBe("Fair");
  });

  test("generateDynamicAnalysis returns a stable structured fallback shape", () => {
    const service = new OpenRouterService();

    const first = service.generateDynamicAnalysis("abc123", "bathroom.jpg");
    const second = service.generateDynamicAnalysis("abc123", "bathroom.jpg");

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      score: expect.any(Number),
      analysis: {
        overall_score: expect.any(Number),
        accessibility_features: expect.any(Array),
        barriers: expect.any(Array),
        recommendations: expect.any(Array),
        confidence: 0.8,
        analysis_method: "dynamic_image_analysis",
      },
      metadata: {
        filename: "bathroom.jpg",
        model_used: "dynamic-analysis",
        processing_time_ms: 100,
        image_hash: expect.any(String),
      },
    });
  });
});
