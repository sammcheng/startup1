"use strict";

const DEFAULT_RETRY_AFTER_SECONDS = 30;

class AnalysisProviderError extends Error {
  constructor(
    message,
    {
      cause,
      code = "ANALYSIS_PROVIDER_UNAVAILABLE",
      statusCode = 503,
      publicError = "Analysis service unavailable",
      userMessage = "The AI analysis provider is temporarily unavailable. Please try again.",
      retryable = true,
      retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS,
    } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "AnalysisProviderError";
    this.code = code;
    this.statusCode = statusCode;
    this.publicError = publicError;
    this.userMessage = userMessage;
    this.retryable = retryable;
    this.retryAfterSeconds = retryable ? retryAfterSeconds : null;
  }
}

function providerNotConfiguredError() {
  return new AnalysisProviderError("OPENROUTER_API_KEY is not configured", {
    code: "ANALYSIS_PROVIDER_NOT_CONFIGURED",
    userMessage:
      "Image analysis is not configured right now. Please try again later.",
    retryable: false,
  });
}

function invalidProviderResponseError(message, cause) {
  return new AnalysisProviderError(message, {
    cause,
    code: "ANALYSIS_PROVIDER_INVALID_RESPONSE",
    statusCode: 502,
    publicError: "Invalid analysis response",
    userMessage:
      "The AI provider returned an invalid response. Please try again.",
  });
}

function normalizeProviderError(error, operation) {
  if (error instanceof AnalysisProviderError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const timedOut =
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    error?.code === "ETIMEDOUT" ||
    /timed?\s*out|timeout/i.test(message);

  return new AnalysisProviderError(`${operation} failed: ${message}`, {
    cause: error instanceof Error ? error : undefined,
    code: timedOut
      ? "ANALYSIS_PROVIDER_TIMEOUT"
      : "ANALYSIS_PROVIDER_UNAVAILABLE",
    statusCode: timedOut ? 504 : 503,
    publicError: timedOut
      ? "Analysis timed out"
      : "Analysis service unavailable",
    userMessage: timedOut
      ? "The AI analysis provider took too long to respond. Please try again."
      : "The AI analysis provider is temporarily unavailable. Please try again.",
  });
}

module.exports = {
  AnalysisProviderError,
  invalidProviderResponseError,
  normalizeProviderError,
  providerNotConfiguredError,
};
