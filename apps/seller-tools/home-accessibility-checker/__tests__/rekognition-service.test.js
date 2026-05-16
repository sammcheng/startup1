const OpenRouterVisionService = require("../services/rekognition-service");

describe("OpenRouterVisionService", () => {
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

  test("parseTextResponse extracts a bounded structured analysis", () => {
    const service = new OpenRouterVisionService();

    const result = service.parseTextResponse(
      [
        "Accessibility score: 77",
        "Features: Wide doorway, Good lighting, Clear pathways",
        "Barriers: High threshold, Steps without ramps",
        "Recommendations: Install a threshold ramp, Add handrails",
      ].join("\n"),
    );

    expect(result).toEqual({
      score: 77,
      accessibility_features: [
        "Wide doorway",
        "Good lighting",
        "Clear pathways",
      ],
      barriers: ["High threshold", "Steps without ramps"],
      recommendations: ["Install a threshold ramp", "Add handrails"],
    });
  });

  test("generateDynamicAnalysis returns a stable structured fallback shape", () => {
    const service = new OpenRouterVisionService();

    const first = service.generateDynamicAnalysis("abc123", "kitchen.jpg");
    const second = service.generateDynamicAnalysis("abc123", "kitchen.jpg");

    expect(first.score).toBe(second.score);
    expect(first.analysis).toEqual(second.analysis);
    expect(first.metadata.filename).toBe(second.metadata.filename);
    expect(first.metadata.image_hash).toBe(second.metadata.image_hash);
    expect(first.metadata.model_used).toBe(second.metadata.model_used);
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
        filename: "kitchen.jpg",
        model_used: "dynamic-analysis",
        processing_time_ms: 100,
        image_hash: expect.any(String),
      },
    });
  });

  test("analyzeAccessibility falls back cleanly when no API key is configured", async () => {
    const service = new OpenRouterVisionService();

    const result = await service.analyzeAccessibility("abc123", "hallway.jpg");

    expect(result.analysis.analysis_method).toBe("dynamic_image_analysis");
    expect(result.metadata.filename).toBe("hallway.jpg");
    expect(result.score).toBe(result.analysis.overall_score);
  });
});
