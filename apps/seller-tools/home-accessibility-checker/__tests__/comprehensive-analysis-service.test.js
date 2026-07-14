const ComprehensiveAnalysisService = require("../services/comprehensive-analysis-service");
const {
  AnalysisProviderError,
} = require("../services/analysis-provider-error");

describe("ComprehensiveAnalysisService", () => {
  test("calculateOverallConfidence uses only provider-supplied confidence", () => {
    const service = new ComprehensiveAnalysisService();

    expect(
      service.calculateOverallConfidence([
        { vision: { analysis: { confidence: 92 } } },
        { vision: { analysis: { confidence: 88 } } },
      ]),
    ).toBe(90);
    expect(
      service.calculateOverallConfidence([
        { vision: { analysis: {} } },
        { vision: { analysis: {} } },
      ]),
    ).toBeNull();
  });

  test("synthesizeResults averages real provider scores and exposes partial state", () => {
    const service = new ComprehensiveAnalysisService();
    const result = service.synthesizeResults(
      [visionResult("entry.jpg", 72)],
      comprehensiveResult(81),
      ["Wide doorway"],
      ["Step at entrance"],
      ["Assess a ramp"],
      2,
      [{ filename: "bathroom.jpg", code: "PROVIDER_ERROR" }],
    );

    expect(result.analysis.overall_score).toBe(77);
    expect(result.partial).toBe(true);
    expect(result.analysis).toMatchObject({
      analyzed_images: 1,
      requested_images: 2,
      failed_images: 1,
      failed_image_names: ["bathroom.jpg"],
      analysis_methods: {
        vision_ai: true,
        comprehensive_ai: true,
        combined: true,
        partial: true,
      },
      providers: {
        vision: ["openai/test-vision"],
        comprehensive: "openai/test-comprehensive",
      },
    });
    expect(result.analysis.accessibility_features).toEqual(
      expect.arrayContaining(["Wide doorway", "Grab bars"]),
    );
  });

  test("createVisionOnlyAnalysis contains only successful provider findings", () => {
    const service = new ComprehensiveAnalysisService();
    const result = service.createVisionOnlyAnalysis(
      [visionResult("bathroom.jpg", 64)],
      ["Grab bars"],
      ["Narrow doorway"],
      ["Measure the doorway"],
      ["Loose rug"],
      ["No scale reference"],
      1,
    );

    expect(result.partial).toBe(true);
    expect(result.analysis).toMatchObject({
      overall_score: 64,
      analyzed_images: 1,
      requested_images: 1,
      accessibility_features: ["Grab bars"],
      positive_features: ["Grab bars"],
      barriers: ["Narrow doorway"],
      recommendations: ["Measure the doorway"],
      analysis_methods: {
        vision_ai: true,
        comprehensive_ai: false,
        combined: false,
        partial: true,
      },
    });
  });

  test("analyzeImages returns real vision data when comprehensive synthesis fails", async () => {
    const service = configuredService();
    service.visionService.analyzeAccessibility.mockResolvedValue(
      visionResult("entry.jpg", 74).vision,
    );
    service.openrouterService.analyzeAccessibility.mockRejectedValue(
      providerFailure(),
    );

    const result = await service.analyzeImages([
      {
        filename: "entry.jpg",
        base64: "abc123",
        mimetype: "image/jpeg",
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.analysis.overall_score).toBe(74);
    expect(result.analysis.analysis_methods.comprehensive_ai).toBe(false);
  });

  test("analyzeImages rejects total provider failure instead of returning zeros", async () => {
    const service = configuredService();
    service.visionService.analyzeAccessibility.mockRejectedValue(
      providerFailure(),
    );
    service.openrouterService.analyzeAccessibility.mockRejectedValue(
      providerFailure(),
    );

    await expect(
      service.analyzeImages([
        {
          filename: "entry.jpg",
          base64: "abc123",
          mimetype: "image/jpeg",
        },
      ]),
    ).rejects.toMatchObject({
      code: "ANALYSIS_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });
  });

  test("analyzeImages logs the measured aggregate score", async () => {
    const service = configuredService();
    service.visionService.analyzeAccessibility.mockResolvedValue(
      visionResult("entry.jpg", 74).vision,
    );
    service.openrouterService.analyzeAccessibility.mockResolvedValue(
      comprehensiveResult(83),
    );

    const result = await service.analyzeImages([
      {
        filename: "entry.jpg",
        base64: "abc123",
        mimetype: "image/jpeg",
      },
    ]);

    expect(result.analysis.overall_score).toBe(79);
    expect(service.logger.info).toHaveBeenCalledWith(
      "Comprehensive analysis completed",
      expect.objectContaining({
        finalScore: 79,
        analyzedImages: 1,
        requestedImages: 1,
      }),
    );
  });
});

function configuredService() {
  const service = new ComprehensiveAnalysisService();
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  service.visionService = {
    isConfigured: () => true,
    analyzeAccessibility: jest.fn(),
  };
  service.openrouterService = {
    isConfigured: () => true,
    analyzeAccessibility: jest.fn(),
  };
  return service;
}

function visionResult(filename, score) {
  return {
    filename,
    vision: {
      score,
      analysis: {
        accessibility_features: ["Wide doorway"],
        barriers: ["Step at entrance"],
        recommendations: ["Assess a ramp"],
        safety_concerns: [],
        limitations: ["Measurements require an in-person assessment"],
      },
      metadata: {
        model_used: "openai/test-vision",
      },
    },
  };
}

function comprehensiveResult(score) {
  return {
    score,
    positive_features: ["Grab bars"],
    barriers: ["High threshold"],
    safety_concerns: [],
    recommendations: ["Measure the threshold"],
    limitations: ["No scale reference"],
    metadata: {
      model_used: "openai/test-comprehensive",
    },
  };
}

function providerFailure() {
  return new AnalysisProviderError("Provider unavailable");
}
