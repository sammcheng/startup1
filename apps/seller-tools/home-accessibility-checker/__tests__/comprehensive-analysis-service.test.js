const ComprehensiveAnalysisService = require("../services/comprehensive-analysis-service");

describe("ComprehensiveAnalysisService", () => {
  test("calculateOverallConfidence reads confidence from vision results", () => {
    const service = new ComprehensiveAnalysisService();

    const confidence = service.calculateOverallConfidence([
      { vision: { analysis: { confidence: 92 } } },
      { vision: { analysis: { confidence: 88 } } },
    ]);

    expect(confidence).toBe(90);
  });

  test("synthesizeResults includes comprehensive model insights from top-level fields", () => {
    const service = new ComprehensiveAnalysisService();

    const result = service.synthesizeResults(
      [
        {
          filename: "entry.jpg",
          vision: {
            score: 72,
            analysis: {
              accessibility_features: ["Wide doorway"],
              barriers: ["Step at entrance"],
              recommendations: ["Add a ramp"],
              confidence: 88,
            },
            metadata: {
              model_used: "gpt-4o-vision",
            },
          },
        },
      ],
      {
        score: 81,
        positive_features: ["Grab bars"],
        barriers: ["High threshold"],
        recommendations: ["Install a threshold ramp"],
        metadata: {
          model_used: "gpt-4o",
        },
      },
      ["Wide doorway"],
      ["Step at entrance"],
      ["Add a ramp"],
      1,
    );

    expect(result.analysis.accessibility_features).toEqual(
      expect.arrayContaining(["Wide doorway", "Grab bars"]),
    );
    expect(result.analysis.barriers).toEqual(
      expect.arrayContaining(["Step at entrance", "High threshold"]),
    );
    expect(result.analysis.recommendations).toEqual(
      expect.arrayContaining(["Add a ramp", "Install a threshold ramp"]),
    );
  });

  test("createFallbackAnalysis returns accessibility_features and compatibility alias", () => {
    const service = new ComprehensiveAnalysisService();

    const result = service.createFallbackAnalysis(
      [
        {
          filename: "bathroom.jpg",
          vision: {
            score: 64,
            analysis: {
              confidence: 84,
            },
          },
        },
      ],
      ["Grab bars"],
      ["Narrow doorway"],
      ["Widen the doorway"],
      64,
      1,
    );

    expect(result.analysis.accessibility_features).toEqual(["Grab bars"]);
    expect(result.analysis.positive_features).toEqual(["Grab bars"]);
    expect(result.analysis.barriers).toEqual(["Narrow doorway"]);
    expect(result.analysis.recommendations).toEqual(["Widen the doorway"]);
  });

  test("analyzeImages logs the synthesized overall score", async () => {
    const service = new ComprehensiveAnalysisService();
    service.logger = {
      info: jest.fn(),
      error: jest.fn(),
    };
    service.visionService = {
      analyzeAccessibility: jest.fn().mockResolvedValue({
        score: 74,
        analysis: {
          accessibility_features: ["Wide doorway"],
          barriers: ["Step at entrance"],
          recommendations: ["Add a ramp"],
          confidence: 91,
        },
        metadata: {
          model_used: "gpt-4o-vision",
        },
      }),
    };
    service.openrouterService = {
      analyzeAccessibility: jest.fn().mockResolvedValue({
        score: 83,
        positive_features: ["Grab bars"],
        barriers: ["High threshold"],
        recommendations: ["Install a threshold ramp"],
        metadata: {
          model_used: "gpt-4o",
        },
      }),
    };

    const result = await service.analyzeImages([
      { filename: "entry.jpg", base64: "abc123" },
    ]);

    expect(result.analysis.overall_score).toBe(83);
    expect(service.logger.info).toHaveBeenCalledWith(
      "Comprehensive analysis completed",
      expect.objectContaining({
        finalScore: 83,
        totalImages: 1,
      }),
    );
  });
});
