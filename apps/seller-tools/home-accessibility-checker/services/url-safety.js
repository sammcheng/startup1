"use strict";

const dns = require("dns").promises;
const net = require("net");

const LISTING_HOST_SUFFIXES = ["zillow.com", "redfin.com", "realtor.com"];
const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".home.arpa",
];

function parseSafeHttpsUrl(rawUrl, { allowedHostSuffixes } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw unsafeUrlError("The URL is invalid");
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (parsed.protocol !== "https:") {
    throw unsafeUrlError("Only HTTPS URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw unsafeUrlError("URLs containing credentials are not allowed");
  }
  if (parsed.port && parsed.port !== "443") {
    throw unsafeUrlError("Only the standard HTTPS port is allowed");
  }
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw unsafeUrlError("Local network hosts are not allowed");
  }
  if (
    allowedHostSuffixes?.length &&
    !allowedHostSuffixes.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  ) {
    throw unsafeUrlError("The URL host is not supported");
  }

  if (net.isIP(hostname) !== 6) {
    parsed.hostname = hostname;
  }
  return parsed;
}

async function assertPublicHttpsUrl(
  rawUrl,
  { allowedHostSuffixes, lookup = dns.lookup } = {},
) {
  const parsed = parseSafeHttpsUrl(rawUrl, { allowedHostSuffixes });
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw unsafeUrlError("Private or reserved IP addresses are not allowed");
    }
    return parsed.toString();
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw unsafeUrlError("The URL host could not be resolved");
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw unsafeUrlError("The URL host did not resolve to an address");
  }
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw unsafeUrlError(
      "The URL host resolves to a private or reserved address",
    );
  }

  return parsed.toString();
}

function isPublicIpAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255)) {
    return false;
  }
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return false;
  }
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return net.isIP(mappedIpv4) === 4 && isPublicIpv4(mappedIpv4);
  }
  return normalized.startsWith("2") || normalized.startsWith("3");
}

function unsafeUrlError(message) {
  const error = new Error(message);
  error.code = "UNSAFE_REMOTE_URL";
  error.statusCode = 400;
  error.publicError = "Unsafe remote URL";
  error.userMessage =
    "The remote URL is not allowed. Upload photos directly instead.";
  return error;
}

module.exports = {
  LISTING_HOST_SUFFIXES,
  assertPublicHttpsUrl,
  isPublicIpAddress,
  parseSafeHttpsUrl,
};
