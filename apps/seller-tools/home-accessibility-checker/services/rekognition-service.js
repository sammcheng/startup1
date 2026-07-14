"use strict";

const OpenAI = require("openai");
const { getRuntimeConfig } = require("../config");
const { createLogger } = require("../logger");
const {
  invalidProviderResponseError,
  normalizeProviderError,
  providerNotConfiguredError,
} = require("./analysis-provider-error");

class OpenRouterVisionService {
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
    this.logger = createLogger({ service: "openrouter-vision-service" });
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
      this.logger.info("Starting OpenRouter vision analysis", {
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
                { type: "text", text: this.createVisionPrompt() },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${normalizeImageMimeType(mimeType)};base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 1600,
          temperature: 0.2,
        },
        {
          timeout: this.requestTimeoutMs,
          maxRetries: 1,
        },
      );

      const analysisText = response?.choices?.[0]?.message?.content;
      const analysis = this.parseAnalysisResponse(analysisText);
      const processingTimeMs = Math.max(Date.now() - startedAt, 1);
      const result = {
        score: analysis.score,
        analysis: {
          overall_score: analysis.score,
          accessibility_features: analysis.accessibility_features,
          barriers: analysis.barriers,
          recommendations: analysis.recommendations,
          safety_concerns: analysis.safety_concerns,
          limitations: analysis.limitations,
          analysis_method: "openrouter_vision",
        },
        metadata: {
          filename,
          timestamp: new Date().toISOString(),
          model_used: this.model,
          processing_time_ms: processingTimeMs,
        },
      };

      this.logger.info("OpenRouter vision analysis completed", {
        filename,
        model: this.model,
        processingTimeMs,
        score: result.score,
      });
      return result;
    } catch (error) {
      const providerError = normalizeProviderError(
        error,
        "OpenRouter vision analysis",
      );
      this.logger.error("OpenRouter vision analysis failed", {
        filename,
        code: providerError.code,
        error: providerError.message,
      });
      throw providerError;
    }
  }

  createVisionPrompt() {
    return `Inspect this home image for visible accessibility and safety conditions.

Do not guess exact dimensions, slopes, lighting levels, or legal/ADA compliance. Only report findings grounded in visible evidence, and call out anything that needs an in-person measurement.

Return one JSON object:
{
  "score": 75,
  "accessibility_features": ["Visible accessibility feature"],
  "barriers": ["Visible accessibility barrier"],
  "safety_concerns": ["Visible safety concern"],
  "recommendations": ["Practical improvement"],
  "limitations": ["What cannot be confirmed from this image"]
}`;
  }

  parseAnalysisResponse(analysisText) {
    if (typeof analysisText !== "string" || !analysisText.trim()) {
      throw invalidProviderResponseError(
        "OpenRouter returned an empty vision analysis",
      );
    }

    const parsed = parseJsonObject(analysisText);
    if (parsed) {
      return normalizeVisionAnalysis(parsed);
    }
    return this.parseTextResponse(analysisText);
  }

  parseTextResponse(text) {
    const scoreMatch = text.match(
      /(?:overall\s+|accessibility\s+)?score\s*[:=-]?\s*(\d{1,3})/i,
    );
    if (!scoreMatch) {
      throw invalidProviderResponseError(
        "OpenRouter vision response did not include an accessibility score",
      );
    }

    const result = {
      score: requireScore(scoreMatch[1]),
      accessibility_features: extractLabeledItems(text, [
        "features",
        "accessibility features",
      ]),
      barriers: extractLabeledItems(text, ["barriers"]),
      safety_concerns: extractLabeledItems(text, ["safety concerns"]),
      recommendations: extractLabeledItems(text, ["recommendations"]),
      limitations: extractLabeledItems(text, ["limitations"]),
    };
    requireFindings(result);
    return result;
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

function normalizeVisionAnalysis(parsed) {
  const result = {
    score: requireScore(parsed.score),
    accessibility_features: normalizeStringArray(parsed.accessibility_features),
    barriers: normalizeStringArray(parsed.barriers),
    safety_concerns: normalizeStringArray(parsed.safety_concerns),
    recommendations: normalizeStringArray(parsed.recommendations),
    limitations: normalizeStringArray(parsed.limitations),
  };
  requireFindings(result);
  return result;
}

function requireScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw invalidProviderResponseError(
      "OpenRouter returned an invalid vision accessibility score",
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

function extractLabeledItems(text, labels) {
  const items = [];
  for (const line of text.split("\n")) {
    const normalizedLine = line.trim();
    const lowerLine = normalizedLine.toLowerCase();
    if (!labels.some((label) => lowerLine.startsWith(`${label}:`))) {
      continue;
    }
    const value = normalizedLine.replace(/^[^:]+:\s*/, "");
    for (const item of value.split(",")) {
      const normalizedItem = item.trim();
      if (normalizedItem && !items.includes(normalizedItem)) {
        items.push(normalizedItem);
      }
    }
  }
  return items.slice(0, 10);
}

function requireFindings(result) {
  const findingCount = [
    result.accessibility_features,
    result.barriers,
    result.safety_concerns,
    result.recommendations,
  ].reduce((total, values) => total + values.length, 0);
  if (findingCount === 0) {
    throw invalidProviderResponseError(
      "OpenRouter vision response did not include any accessibility findings",
    );
  }
}

function normalizeImageMimeType(value) {
  if (value === "image/jpg") return "image/jpeg";
  if (["image/jpeg", "image/png", "image/webp"].includes(value)) return value;
  return "image/jpeg";
}

module.exports = OpenRouterVisionService;
