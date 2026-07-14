"use strict";

const crypto = require("crypto");

const SIGNATURE_VERSION = "ed25519-v1";
const SIGNATURE_HEADER = "X-HackMarket-Signature";
const SIGNATURE_VERSION_HEADER = "X-HackMarket-Signature-Version";
const SIGNATURE_KEY_ID_HEADER = "X-HackMarket-Signature-Key-Id";
const SIGNATURE_TIMESTAMP_HEADER = "X-HackMarket-Signature-Timestamp";
const REQUEST_ID_HEADER = "X-HackMarket-Request-Id";
const TOOL_SLUG_HEADER = "X-HackMarket-Tool-Slug";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const DEFAULT_MAX_REPLAY_ENTRIES = 10000;

function decodeBase64Url(value, expectedLength, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || !BASE64URL_PATTERN.test(normalized)) {
    throw new Error(`${label} must be valid base64url`);
  }

  const decoded = Buffer.from(normalized.replace(/=+$/, ""), "base64url");
  if (decoded.length !== expectedLength) {
    throw new Error(`${label} must decode to exactly ${expectedLength} bytes`);
  }
  return decoded;
}

function createEd25519PublicKey(encodedPublicKey) {
  const rawKey = decodeBase64Url(
    encodedPublicKey,
    32,
    "gateway signing public key",
  );
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
    format: "der",
    type: "spki",
  });
}

function buildCanonicalMessage({
  method,
  requestTarget,
  timestamp,
  requestId,
  toolSlug,
  keyId,
}) {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error("gateway signing key ID is invalid");
  }
  if (!requestTarget.startsWith("/")) {
    throw new Error("gateway request target must start with '/'");
  }

  const values = [
    SIGNATURE_VERSION,
    keyId,
    String(timestamp),
    requestId,
    toolSlug,
    method.toUpperCase(),
    requestTarget,
  ];
  if (values.some((value) => /[\0\r\n]/.test(value))) {
    throw new Error("gateway signing fields cannot contain control characters");
  }
  return Buffer.from(values.join("\n"), "utf8");
}

function createGatewayVerifier({
  publicKey,
  keyId,
  expectedToolSlug,
  maxAgeSeconds,
  allowUnsigned = false,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  replayCache = new Map(),
  maxReplayEntries = DEFAULT_MAX_REPLAY_ENTRIES,
}) {
  let publicKeyObject = null;
  let configurationError = null;

  try {
    if (!publicKey) throw new Error("gateway signing public key is missing");
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new Error("gateway signing key ID is invalid");
    }
    if (!expectedToolSlug) throw new Error("gateway tool slug is missing");
    if (
      !Number.isInteger(maxAgeSeconds) ||
      maxAgeSeconds < 30 ||
      maxAgeSeconds > 900
    ) {
      throw new Error(
        "gateway signature lifetime must be between 30 and 900 seconds",
      );
    }
    publicKeyObject = createEd25519PublicKey(publicKey);
  } catch (error) {
    configurationError = error.message;
  }

  const configured = Boolean(publicKeyObject);

  function verifyRequest(req) {
    if (!configured) {
      if (allowUnsigned) return { ok: true, unsigned: true };
      return failure(
        503,
        "GATEWAY_AUTH_NOT_CONFIGURED",
        "Gateway authentication is not configured.",
      );
    }

    const version = req.get(SIGNATURE_VERSION_HEADER);
    const receivedKeyId = req.get(SIGNATURE_KEY_ID_HEADER);
    const timestampHeader = req.get(SIGNATURE_TIMESTAMP_HEADER);
    const signatureHeader = req.get(SIGNATURE_HEADER);
    const requestId = req.get(REQUEST_ID_HEADER);
    const toolSlug = req.get(TOOL_SLUG_HEADER);

    if (
      version !== SIGNATURE_VERSION ||
      receivedKeyId !== keyId ||
      !timestampHeader ||
      !signatureHeader ||
      !requestId ||
      toolSlug !== expectedToolSlug
    ) {
      return invalidSignature();
    }

    const timestamp = Number(timestampHeader);
    if (
      !Number.isSafeInteger(timestamp) ||
      String(timestamp) !== timestampHeader
    ) {
      return invalidSignature();
    }

    const currentTime = nowSeconds();
    if (Math.abs(currentTime - timestamp) > maxAgeSeconds) {
      return failure(
        401,
        "GATEWAY_SIGNATURE_EXPIRED",
        "Gateway request signature has expired.",
      );
    }

    let signature;
    try {
      signature = decodeBase64Url(
        signatureHeader,
        64,
        "gateway request signature",
      );
      const message = buildCanonicalMessage({
        method: req.method,
        requestTarget: req.originalUrl,
        timestamp,
        requestId,
        toolSlug,
        keyId,
      });
      if (!crypto.verify(null, message, publicKeyObject, signature)) {
        return invalidSignature();
      }
    } catch (_error) {
      return invalidSignature();
    }

    removeExpiredReplayEntries(replayCache, currentTime);
    const replayKey = `${receivedKeyId}:${requestId}`;
    if ((replayCache.get(replayKey) || 0) > currentTime) {
      return failure(
        409,
        "GATEWAY_REQUEST_REPLAYED",
        "Gateway request has already been processed.",
      );
    }
    evictReplayEntries(replayCache, maxReplayEntries);
    replayCache.set(replayKey, currentTime + maxAgeSeconds);

    return { ok: true, unsigned: false };
  }

  return {
    allowUnsigned,
    configurationError,
    configured,
    ready: configured || allowUnsigned,
    verifyRequest,
  };
}

function removeExpiredReplayEntries(replayCache, currentTime) {
  for (const [key, expiresAt] of replayCache.entries()) {
    if (expiresAt <= currentTime) replayCache.delete(key);
  }
}

function evictReplayEntries(replayCache, maxReplayEntries) {
  while (replayCache.size >= maxReplayEntries) {
    const oldestKey = replayCache.keys().next().value;
    if (oldestKey === undefined) break;
    replayCache.delete(oldestKey);
  }
}

function invalidSignature() {
  return failure(
    401,
    "INVALID_GATEWAY_SIGNATURE",
    "Gateway request signature is invalid.",
  );
}

function failure(statusCode, code, message) {
  return { ok: false, statusCode, code, message };
}

module.exports = {
  SIGNATURE_HEADER,
  SIGNATURE_KEY_ID_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  SIGNATURE_VERSION,
  SIGNATURE_VERSION_HEADER,
  buildCanonicalMessage,
  createGatewayVerifier,
};
