"use strict";

const OpenAI = require("openai");
const { getRuntimeConfig } = require("../config");
const { createLogger } = require("../logger");
const {
  invalidProviderResponseError,
  normalizeProviderError,
  providerNotConfiguredError,
} = require("./analysis-provider-error");

class OpenRouterService {
  constructor() {
    const runtimeConfig = getRuntimeConfig();
    this.apiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
    this.model = runtimeConfig.openrouterModel;
    this.requestTimeoutMs = runtimeConfig.openrouterTimeoutMs;
    this.openaiClient = this.apiKey
      ? new OpenAI({
          apiKey: this.apiKey,
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: {
            "HTTP-Referer": runtimeConfig.publicAppUrl,
            "X-Title": "Accessibility Checker",
          },
        })
      : null;
    this.logger = createLogger({ service: "openrouter-service" });
  }

  isConfigured() {
    return Boolean(this.openaiClient);
  }

  async analyzeAccessibility(base64Image, filename, mimeType = "image/jpeg") {
    if (!this.openaiClient) {
      throw providerNotConfiguredError();
    }

    const startedAt = Date.now();
    try {
      this.logger.info("Starting comprehensive OpenRouter analysis", {
        filename,
        model: this.model,
      });

      const response = await this.openaiClient.chat.completions.create(
        {
          model: this.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: this.createAccessibilityPrompt() },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${normalizeImageMimeType(mimeType)};base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 2000,
          temperature: 0.2,
        },
        {
          timeout: this.requestTimeoutMs,
          maxRetries: 1,
        },
      );

      const analysisText = response?.choices?.[0]?.message?.content;
      const structuredResult = this.parseAnalysisResponse(
        analysisText,
        filename,
      );
      const processingTimeMs = Math.max(Date.now() - startedAt, 1);

      this.logger.info("Comprehensive OpenRouter analysis completed", {
        filename,
        model: this.model,
        processingTimeMs,
        score: structuredResult.score,
      });

      return {
        ...structuredResult,
        metadata: {
          filename,
          timestamp: new Date().toISOString(),
          model_used: this.model,
          processing_time_ms: processingTimeMs,
        },
      };
    } catch (error) {
      const providerError = normalizeProviderError(
        error,
        "Comprehensive OpenRouter analysis",
      );
      this.logger.error("Comprehensive OpenRouter analysis failed", {
        filename,
        code: providerError.code,
        error: providerError.message,
      });
      throw providerError;
    }
  }

  createAccessibilityPrompt() {
    return `Analyze this home image for visible accessibility features, barriers, and safety concerns.

Rules:
- Base every finding on something visible in the image.
- Do not infer exact dimensions, slopes, lighting levels, or legal/ADA compliance from pixels alone.
- If a measurement or area cannot be verified, say so instead of guessing.
- Treat the score as a visual screening score, not a certification.
- Give practical recommendations and prioritize immediate safety concerns.

Return one JSON object with this shape:
{
  "score": 75,
  "positive_features": ["Visible feature and why it helps"],
  "barriers": ["Visible barrier and its likely impact"],
  "safety_concerns": ["Visible safety concern"],
  "recommendations": ["Actionable improvement"],
  "accessibility_rating": "Fair",
  "priority_improvements": ["Highest-priority improvement"],
  "limitations": ["Measurements and formal compliance require an in-person assessment"]
}`;
  }

  parseAnalysisResponse(analysisText, filename) {
    if (typeof analysisText !== "string" || !analysisText.trim()) {
      throw invalidProviderResponseError(
        "OpenRouter returned an empty comprehensive analysis",
      );
    }

    const parsed = parseJsonObject(analysisText);
    if (parsed) {
      return this.normalizeStructuredAnalysis(parsed, filename);
    }

    return this.parseTextResponse(analysisText, filename);
  }

  normalizeStructuredAnalysis(parsed, filename) {
    const score = requireScore(parsed.score);
    const result = {
      filename,
      score,
      positive_features: normalizeStringArray(parsed.positive_features),
      barriers: normalizeStringArray(parsed.barriers),
      safety_concerns: normalizeStringArray(parsed.safety_concerns),
      recommendations: normalizeStringArray(parsed.recommendations),
      accessibility_rating:
        normalizeOptionalString(parsed.accessibility_rating) ||
        this.getRatingFromScore(score),
      priority_improvements: normalizeStringArray(parsed.priority_improvements),
      limitations: normalizeStringArray(parsed.limitations),
    };

    requireFindings(result);
    return result;
  }

  parseTextResponse(analysisText, filename) {
    const scoreMatch = analysisText.match(
      /(?:overall\s+|accessibility\s+)?score\s*[:=-]?\s*(\d{1,3})/i,
    );
    if (!scoreMatch) {
      throw invalidProviderResponseError(
        "OpenRouter response did not include an accessibility score",
      );
    }

    const score = requireScore(scoreMatch[1]);
    const result = {
      filename,
      score,
      positive_features: this.extractItems(analysisText, [
        "positive feature",
        "accessibility feature",
      ]),
      barriers: this.extractItems(analysisText, ["barrier"]),
      safety_concerns: this.extractItems(analysisText, ["safety concern"]),
      recommendations: this.extractItems(analysisText, ["recommendation"]),
      accessibility_rating: this.getRatingFromScore(score),
      priority_improvements: this.extractItems(analysisText, [
        "priority improvement",
      ]),
      limitations: this.extractItems(analysisText, ["limitation"]),
    };

    requireFindings(result);
    return result;
  }

  extractItems(text, labels) {
    const items = [];
    for (const line of text.split("\n")) {
      const normalizedLine = line.trim();
      const lowerLine = normalizedLine.toLowerCase();
      if (!labels.some((label) => lowerLine.includes(label))) {
        continue;
      }

      const value = normalizedLine
        .replace(/^[-*]\s*/, "")
        .replace(/^[^:]+:\s*/, "")
        .trim();
      for (const item of value.split(",")) {
        const normalizedItem = item.trim();
        if (normalizedItem && !items.includes(normalizedItem)) {
          items.push(normalizedItem);
        }
      }
    }
    return items.slice(0, 10);
  }

  getRatingFromScore(score) {
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Good";
    if (score >= 70) return "Fair";
    if (score >= 60) return "Poor";
    return "Very Poor";
  }
}

function parseJsonObject(text) {
  const candidates = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // A provider may wrap valid findings in prose; try the next candidate.
    }
  }
  return null;
}

function requireScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw invalidProviderResponseError(
      "OpenRouter returned an invalid accessibility score",
    );
  }
  return Math.round(score);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireFindings(result) {
  const findingCount = [
    result.positive_features,
    result.barriers,
    result.safety_concerns,
    result.recommendations,
  ].reduce((total, values) => total + values.length, 0);
  if (findingCount === 0) {
    throw invalidProviderResponseError(
      "OpenRouter response did not include any accessibility findings",
    );
  }
}

function normalizeImageMimeType(value) {
  if (value === "image/jpg") return "image/jpeg";
  if (["image/jpeg", "image/png", "image/webp"].includes(value)) return value;
  return "image/jpeg";
}

module.exports = OpenRouterService;
