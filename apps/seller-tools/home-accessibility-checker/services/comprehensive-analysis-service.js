"use strict";

const OpenRouterVisionService = require("./rekognition-service");
const OpenRouterService = require("./openrouter-service");
const { providerNotConfiguredError } = require("./analysis-provider-error");
const { createLogger } = require("../logger");

const ASSESSMENT_NOTICE =
  "This is a visual screening, not an accessibility certification. Verify dimensions and compliance in person with a qualified professional.";

class ComprehensiveAnalysisService {
  constructor() {
    this.visionService = new OpenRouterVisionService();
    this.openrouterService = new OpenRouterService();
    this.logger = createLogger({ service: "comprehensive-analysis-service" });
  }

  async analyzeImages(images) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new TypeError("At least one image is required for analysis");
    }
    if (
      (typeof this.visionService.isConfigured === "function" &&
        !this.visionService.isConfigured()) ||
      (typeof this.openrouterService.isConfigured === "function" &&
        !this.openrouterService.isConfigured())
    ) {
      throw providerNotConfiguredError();
    }

    this.logger.info("Starting comprehensive analysis", {
      imageCount: images.length,
    });

    const analysisResults = [];
    const failedImages = [];
    const allAccessibilityFeatures = [];
    const allBarriers = [];
    const allRecommendations = [];
    const allSafetyConcerns = [];
    const allLimitations = [];

    for (const image of images) {
      try {
        const visionResult = await this.visionService.analyzeAccessibility(
          image.base64,
          image.filename,
          image.mimetype,
        );
        analysisResults.push({
          filename: image.filename,
          vision: visionResult,
        });
        allAccessibilityFeatures.push(
          ...visionResult.analysis.accessibility_features,
        );
        allBarriers.push(...visionResult.analysis.barriers);
        allRecommendations.push(...visionResult.analysis.recommendations);
        allSafetyConcerns.push(
          ...(visionResult.analysis.safety_concerns || []),
        );
        allLimitations.push(...(visionResult.analysis.limitations || []));
      } catch (error) {
        this.logger.error("Vision analysis failed for image", {
          filename: image.filename,
          code: error.code,
          error: error.message,
        });
        failedImages.push({
          filename: image.filename,
          code: error.code || "VISION_ANALYSIS_FAILED",
          retryable: error.retryable !== false,
        });
        analysisResults.push({
          filename: image.filename,
          vision: {
            error: {
              code: error.code || "VISION_ANALYSIS_FAILED",
              retryable: error.retryable !== false,
            },
          },
        });
      }
    }

    let comprehensiveResult;
    try {
      comprehensiveResult = await this.openrouterService.analyzeAccessibility(
        images[0].base64,
        "comprehensive_analysis",
        images[0].mimetype,
      );
    } catch (error) {
      this.logger.error("Comprehensive synthesis failed", {
        code: error.code,
        error: error.message,
      });

      const successfulVisionResults = validVisionResults(analysisResults);
      if (successfulVisionResults.length === 0) {
        throw error;
      }

      const partialResult = this.createVisionOnlyAnalysis(
        analysisResults,
        allAccessibilityFeatures,
        allBarriers,
        allRecommendations,
        allSafetyConcerns,
        allLimitations,
        images.length,
        failedImages,
      );
      this.logger.warn("Returning partial vision-only analysis", {
        analyzedImages: partialResult.analysis.analyzed_images,
        failedImages: partialResult.analysis.failed_images,
      });
      return partialResult;
    }

    const finalAnalysis = this.synthesizeResults(
      analysisResults,
      comprehensiveResult,
      allAccessibilityFeatures,
      allBarriers,
      allRecommendations,
      images.length,
      failedImages,
      allSafetyConcerns,
      allLimitations,
    );
    this.logger.info("Comprehensive analysis completed", {
      finalScore: finalAnalysis.analysis.overall_score,
      analyzedImages: finalAnalysis.analysis.analyzed_images,
      requestedImages: images.length,
    });
    return finalAnalysis;
  }

  synthesizeResults(
    analysisResults,
    comprehensiveResult,
    allAccessibilityFeatures,
    allBarriers,
    allRecommendations,
    imageCount,
    failedImages = [],
    allSafetyConcerns = [],
    allLimitations = [],
  ) {
    const validResults = validVisionResults(analysisResults);
    const scores = [
      ...validResults.map((result) => result.vision.score),
      comprehensiveResult.score,
    ].filter((score) => Number.isFinite(score));
    if (scores.length === 0) {
      throw new TypeError("No valid provider scores were available");
    }
    const overallScore = Math.round(
      scores.reduce((sum, score) => sum + score, 0) / scores.length,
    );
    const visionProviders = unique(
      validResults
        .map((result) => result.vision.metadata?.model_used)
        .filter(Boolean),
    );
    const comprehensiveProvider =
      comprehensiveResult.metadata?.model_used || null;
    const confidence = this.calculateOverallConfidence(validResults);

    return {
      success: true,
      partial: failedImages.length > 0,
      analysis: {
        overall_score: overallScore,
        accessibility_rating: this.getRatingFromScore(overallScore),
        analyzed_images: Math.max(validResults.length, 1),
        requested_images: imageCount,
        failed_images: failedImages.length,
        failed_image_names: failedImages.map((failure) => failure.filename),
        accessibility_features: unique([
          ...allAccessibilityFeatures,
          ...this.getAccessibilityFeatures(comprehensiveResult),
        ]),
        barriers: unique([
          ...allBarriers,
          ...this.getBarriers(comprehensiveResult),
        ]),
        safety_concerns: unique([
          ...allSafetyConcerns,
          ...(comprehensiveResult.safety_concerns || []),
        ]),
        recommendations: unique([
          ...allRecommendations,
          ...this.getRecommendations(comprehensiveResult),
        ]),
        limitations: unique([
          ...allLimitations,
          ...(comprehensiveResult.limitations || []),
        ]),
        detailed_results: analysisResults,
        analysis_methods: {
          vision_ai: validResults.length > 0,
          comprehensive_ai: true,
          combined: validResults.length > 0,
          partial: failedImages.length > 0,
        },
        providers: {
          vision: visionProviders,
          comprehensive: comprehensiveProvider,
        },
        ...(confidence === null ? {} : { confidence }),
        assessment_notice: ASSESSMENT_NOTICE,
      },
      timestamp: new Date().toISOString(),
    };
  }

  createVisionOnlyAnalysis(
    analysisResults,
    allAccessibilityFeatures,
    allBarriers,
    allRecommendations,
    allSafetyConcerns,
    allLimitations,
    imageCount,
    failedImages = [],
  ) {
    const validResults = validVisionResults(analysisResults);
    if (validResults.length === 0) {
      throw new TypeError("Vision-only analysis requires a provider result");
    }
    const overallScore = Math.round(
      validResults.reduce((sum, result) => sum + result.vision.score, 0) /
        validResults.length,
    );
    const confidence = this.calculateOverallConfidence(validResults);

    return {
      success: true,
      partial: true,
      analysis: {
        overall_score: overallScore,
        accessibility_rating: this.getRatingFromScore(overallScore),
        analyzed_images: validResults.length,
        requested_images: imageCount,
        failed_images: failedImages.length,
        failed_image_names: failedImages.map((failure) => failure.filename),
        accessibility_features: unique(allAccessibilityFeatures),
        positive_features: unique(allAccessibilityFeatures),
        barriers: unique(allBarriers),
        safety_concerns: unique(allSafetyConcerns),
        recommendations: unique(allRecommendations),
        limitations: unique(allLimitations),
        detailed_results: analysisResults,
        analysis_methods: {
          vision_ai: true,
          comprehensive_ai: false,
          combined: false,
          partial: true,
        },
        providers: {
          vision: unique(
            validResults
              .map((result) => result.vision.metadata?.model_used)
              .filter(Boolean),
          ),
          comprehensive: null,
        },
        ...(confidence === null ? {} : { confidence }),
        assessment_notice: ASSESSMENT_NOTICE,
      },
      timestamp: new Date().toISOString(),
    };
  }

  calculateOverallConfidence(analysisResults) {
    const confidenceValues = analysisResults
      .map((result) => result.vision?.analysis?.confidence)
      .filter((value) => Number.isFinite(value));
    if (confidenceValues.length === 0) return null;
    return Math.round(
      confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length,
    );
  }

  getAccessibilityFeatures(result) {
    return (
      result?.analysis?.accessibility_features ||
      result?.positive_features ||
      []
    );
  }

  getBarriers(result) {
    return result?.analysis?.barriers || result?.barriers || [];
  }

  getRecommendations(result) {
    return result?.analysis?.recommendations || result?.recommendations || [];
  }

  getRatingFromScore(score) {
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Good";
    if (score >= 70) return "Fair";
    if (score >= 60) return "Poor";
    return "Very Poor";
  }
}

function validVisionResults(analysisResults) {
  return analysisResults.filter(
    (result) => !result.vision?.error && Number.isFinite(result.vision?.score),
  );
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

module.exports = ComprehensiveAnalysisService;
