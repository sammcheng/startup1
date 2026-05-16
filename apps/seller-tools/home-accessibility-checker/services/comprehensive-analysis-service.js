/**
 * Comprehensive Analysis Service
 * Uses OpenRouter AI for complete accessibility assessment
 * Provides real AI-powered accessibility analysis pipeline
 */

const OpenRouterVisionService = require("./rekognition-service");
const OpenRouterService = require("./openrouter-service");
const { createLogger } = require("../logger");

class ComprehensiveAnalysisService {
  constructor() {
    this.visionService = new OpenRouterVisionService();
    this.openrouterService = new OpenRouterService();

    this.logger = createLogger({ service: "comprehensive-analysis-service" });
  }

  /**
   * Analyze images using the complete pipeline: vision model -> synthesis model
   * @param {Array} images - Array of image objects with base64 data
   * @returns {Promise<Object>} Comprehensive analysis results
   */
  async analyzeImages(images) {
    try {
      this.logger.info("Starting comprehensive analysis", {
        imageCount: images.length,
      });

      const analysisResults = [];
      let totalScore = 0;
      let allPositiveFeatures = [];
      let allRedFlags = [];
      let allRecommendations = [];

      // Step 1: Analyze each image with the vision model
      for (const image of images) {
        try {
          this.logger.info("Analyzing image with vision model", {
            filename: image.filename,
          });

          const visionResult = await this.visionService.analyzeAccessibility(
            image.base64,
            image.filename,
          );

          analysisResults.push({
            filename: image.filename,
            vision: visionResult,
          });

          // Aggregate vision results
          totalScore += visionResult.score;
          allPositiveFeatures.push(
            ...visionResult.analysis.accessibility_features,
          );
          allRedFlags.push(...visionResult.analysis.barriers);
          allRecommendations.push(...visionResult.analysis.recommendations);
        } catch (error) {
          this.logger.error("Vision analysis failed for image", {
            filename: image.filename,
            error: error.message,
          });

          analysisResults.push({
            filename: image.filename,
            vision: { error: "Vision analysis failed", score: 0 },
          });
        }
      }

      // Step 2: Use OpenRouter for comprehensive analysis

      try {
        this.logger.info("Starting OpenRouter analysis");

        // Use the first image for comprehensive OpenRouter analysis
        const comprehensiveResult =
          await this.openrouterService.analyzeAccessibility(
            images[0].base64,
            "comprehensive_analysis",
          );

        // Step 3: Combine and synthesize results
        const finalAnalysis = this.synthesizeResults(
          analysisResults,
          comprehensiveResult,
          allPositiveFeatures,
          allRedFlags,
          allRecommendations,
          images.length,
        );

        this.logger.info("Comprehensive analysis completed", {
          finalScore: finalAnalysis.analysis.overall_score,
          totalImages: images.length,
        });

        return finalAnalysis;
      } catch (error) {
        this.logger.error("Comprehensive synthesis failed", {
          error: error.message,
        });

        // Fallback to vision-only results
        return this.createFallbackAnalysis(
          analysisResults,
          allPositiveFeatures,
          allRedFlags,
          allRecommendations,
          totalScore,
          images.length,
        );
      }
    } catch (error) {
      this.logger.error("Comprehensive analysis failed", {
        error: error.message,
      });
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  /**
   * Synthesize results from Vision AI and Comprehensive AI
   * @param {Array} analysisResults - Vision analysis results
   * @param {Object} comprehensiveResult - Comprehensive AI analysis
   * @param {Array} allAccessibilityFeatures - All accessibility features
   * @param {Array} allBarriers - All barriers
   * @param {Array} allRecommendations - All recommendations
   * @param {number} imageCount - Number of images analyzed
   * @returns {Object} Final analysis
   */
  synthesizeResults(
    analysisResults,
    comprehensiveResult,
    allAccessibilityFeatures,
    allBarriers,
    allRecommendations,
    imageCount,
  ) {
    const averageScore = Math.round(
      analysisResults.reduce(
        (sum, result) => sum + (result.vision?.score || 0),
        0,
      ) / imageCount,
    );
    const visionModelUsed =
      analysisResults[0]?.vision?.metadata?.model_used || "unknown";
    const comprehensiveModelUsed =
      comprehensiveResult?.metadata?.model_used || "unknown";
    const usedVisionProvider = visionModelUsed !== "dynamic-analysis";
    const usedComprehensiveProvider =
      comprehensiveModelUsed !== "dynamic-analysis";

    // Combine Vision AI and Comprehensive AI insights
    const combinedAccessibilityFeatures = [
      ...new Set([
        ...allAccessibilityFeatures,
        ...this.getAccessibilityFeatures(comprehensiveResult),
      ]),
    ];
    const combinedBarriers = [
      ...new Set([...allBarriers, ...this.getBarriers(comprehensiveResult)]),
    ];
    const combinedRecommendations = [
      ...new Set([
        ...allRecommendations,
        ...this.getRecommendations(comprehensiveResult),
      ]),
    ];

    return {
      success: true,
      analysis: {
        overall_score: Math.max(
          averageScore,
          comprehensiveResult.score || averageScore,
        ),
        analyzed_images: imageCount,
        accessibility_features: combinedAccessibilityFeatures,
        barriers: combinedBarriers,
        recommendations: combinedRecommendations,
        detailed_results: analysisResults,
        analysis_methods: {
          vision_ai: usedVisionProvider,
          comprehensive_ai: usedComprehensiveProvider,
          combined: usedVisionProvider && usedComprehensiveProvider,
          fallback: !usedVisionProvider || !usedComprehensiveProvider,
        },
        providers: {
          vision: visionModelUsed,
          comprehensive: comprehensiveModelUsed,
        },
        confidence: 0.95,
        accessibility_rating: this.getRatingFromScore(
          Math.max(averageScore, comprehensiveResult.score || averageScore),
        ),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create fallback analysis when synthesis fails
   * @param {Array} analysisResults - vision results
   * @param {Array} allPositiveFeatures - Positive features
   * @param {Array} allRedFlags - Red flags
   * @param {Array} allRecommendations - Recommendations
   * @param {number} totalScore - Total score
   * @param {number} imageCount - Image count
   * @returns {Object} Fallback analysis
   */
  createFallbackAnalysis(
    analysisResults,
    allPositiveFeatures,
    allRedFlags,
    allRecommendations,
    totalScore,
    imageCount,
  ) {
    const averageScore = Math.round(totalScore / imageCount);

    return {
      success: true,
      analysis: {
        overall_score: averageScore,
        analyzed_images: imageCount,
        accessibility_features: [...new Set(allPositiveFeatures)],
        positive_features: [...new Set(allPositiveFeatures)],
        barriers: [...new Set(allRedFlags)],
        recommendations: [...new Set(allRecommendations)],
        detailed_results: analysisResults,
        analysis_methods: {
          vision_ai: true,
          comprehensive_ai: false,
          combined: false,
          fallback: true,
        },
        confidence: this.calculateOverallConfidence(analysisResults),
        accessibility_rating: this.getRatingFromScore(averageScore),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate overall confidence from analysis results
   * @param {Array} analysisResults - Analysis results
   * @returns {number} Overall confidence
   */
  calculateOverallConfidence(analysisResults) {
    const validResults = analysisResults.filter(
      (result) => !result.vision.error,
    );
    if (validResults.length === 0) return 0;

    const totalConfidence = validResults.reduce((sum, result) => {
      return sum + (result.vision.analysis?.confidence || 0);
    }, 0);

    return Math.round(totalConfidence / validResults.length);
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

  /**
   * Get accessibility rating from score
   * @param {number} score - Accessibility score
   * @returns {string} Rating
   */
  getRatingFromScore(score) {
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Good";
    if (score >= 70) return "Fair";
    if (score >= 60) return "Poor";
    return "Very Poor";
  }
}

module.exports = ComprehensiveAnalysisService;
