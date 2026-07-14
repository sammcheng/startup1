"use strict";

const { URL } = require("url");
const { getRuntimeConfig } = require("../config");
const { createLogger } = require("../logger");
const { readResponseText } = require("./response-limits");
const {
  LISTING_HOST_SUFFIXES,
  assertPublicHttpsUrl,
  parseSafeHttpsUrl,
} = require("./url-safety");

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const IMAGE_HOST_SUFFIXES = [
  "zillowstatic.com",
  "cdn-redfin.com",
  "rdcpix.com",
];
const MAX_REDIRECTS = 3;

class ListingScraperService {
  constructor() {
    const runtimeConfig = getRuntimeConfig();
    this.fetchTimeoutMs = runtimeConfig.listingFetchTimeoutMs;
    this.maxHtmlBytes = runtimeConfig.maxListingHtmlBytes;
    this.maxImages = runtimeConfig.maxFiles;
    this.assertSafeRemoteUrl = assertPublicHttpsUrl;
    this.logger = createLogger({ service: "listing-scraper-service" });
  }

  async scrape(url, maxImages = this.maxImages) {
    const imageLimit = Math.min(
      Math.max(Math.floor(maxImages), 1),
      this.maxImages,
    );
    this.logger.info("Fetching property listing page", {
      url,
      maxImages: imageLimit,
    });

    const html = await this.fetchListingHtml(url);
    const imageUrls = this.extractImageUrls(html, imageLimit);
    const propertyDetails = this.extractPropertyDetails(html, url);

    return {
      images: imageUrls.map((imageUrl, index) => ({
        filename: `scraped_image_${index + 1}.jpg`,
        url: imageUrl,
        index,
      })),
      propertyDetails,
    };
  }

  async fetchListingHtml(url) {
    const headers = {
      "user-agent": DEFAULT_USER_AGENT,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.google.com/",
      "cache-control": "no-cache",
      pragma: "no-cache",
    };

    try {
      let currentUrl = url;
      for (
        let redirectCount = 0;
        redirectCount <= MAX_REDIRECTS;
        redirectCount++
      ) {
        const safeUrl = await this.assertSafeRemoteUrl(currentUrl, {
          allowedHostSuffixes: LISTING_HOST_SUFFIXES,
        });
        const response = await fetch(safeUrl, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(this.fetchTimeoutMs),
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers?.get?.("location");
          if (!location || redirectCount === MAX_REDIRECTS) {
            throw new Error("Listing page returned an invalid redirect chain");
          }
          currentUrl = new URL(location, safeUrl).toString();
          continue;
        }

        if (!response.ok) {
          const responseError = new Error(
            `Listing page fetch failed with status ${response.status}`,
          );
          responseError.statusCode =
            response.status === 403 ? 502 : response.status;
          responseError.publicError = "Listing fetch failed";
          responseError.userMessage =
            response.status === 403
              ? "This listing site blocked automated access. Try uploading photos directly instead."
              : "We could not fetch the property listing page. Try again or upload photos directly instead.";
          throw responseError;
        }

        const contentType = response.headers?.get?.("content-type") || "";
        if (contentType && !contentType.toLowerCase().includes("text/html")) {
          throw new Error("Listing page returned a non-HTML response");
        }
        return await readResponseText(response, this.maxHtmlBytes);
      }
      throw new Error("Listing page exceeded the redirect limit");
    } catch (error) {
      if (error.code === "UNSAFE_REMOTE_URL" || error.statusCode) {
        throw error;
      }
      const timeout =
        error?.name === "TimeoutError" || error?.name === "AbortError";
      const wrapped = new Error(
        timeout
          ? `Listing page fetch timed out after ${this.fetchTimeoutMs}ms`
          : `Listing page fetch failed: ${error.message}`,
      );
      wrapped.statusCode = 502;
      wrapped.publicError = "Listing fetch failed";
      wrapped.userMessage = timeout
        ? "The listing site took too long to respond. Try again or upload photos directly instead."
        : "We could not fetch the property listing page. Try again or upload photos directly instead.";
      throw wrapped;
    }
  }

  extractImageUrls(html, maxImages) {
    const normalizedHtml = html.replace(/\\u002F/g, "/");
    const patterns = [
      /https:\/\/photos\.zillowstatic\.com\/[^"'\\\s)<>]+/g,
      /https:\/\/ssl\.cdn-redfin\.com\/[^"'\\\s)<>]+/g,
      /https:\/\/ap.rdcpix\.com\/[^"'\\\s)<>]+/g,
    ];

    const urls = new Set();
    for (const pattern of patterns) {
      for (const match of normalizedHtml.matchAll(pattern)) {
        const candidate = this.normalizeUrl(match[0]);
        if (candidate) {
          urls.add(candidate);
        }
        if (urls.size >= maxImages) {
          return Array.from(urls);
        }
      }
    }

    return Array.from(urls).slice(0, maxImages);
  }

  extractPropertyDetails(html, url) {
    const ldJsonBlocks = Array.from(
      html.matchAll(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      ),
    );

    for (const block of ldJsonBlocks) {
      const parsed = this.tryParseJson(block[1]);
      const details = this.extractFromJson(parsed);
      if (details) {
        return details;
      }
    }

    return this.buildFallbackDetails(url);
  }

  extractFromJson(value) {
    if (!value) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.extractFromJson(item);
        if (found) {
          return found;
        }
      }
      return null;
    }

    if (typeof value !== "object") {
      return null;
    }

    const typed = value;
    if (
      typed["@type"] === "House" ||
      typed["@type"] === "SingleFamilyResidence" ||
      typed.address
    ) {
      const address = typed.address || {};
      return {
        address:
          [
            address.streetAddress,
            address.addressLocality,
            address.addressRegion,
            address.postalCode,
          ]
            .filter(Boolean)
            .join(", ") || "Property from listing URL",
        city: address.addressLocality || "Unknown",
        state: address.addressRegion || "Unknown",
        zipCode: address.postalCode || "Unknown",
        propertyType: typed["@type"] || "Property",
        bedrooms:
          this.readFact(typed, ["numberOfRooms", "numberOfBedrooms"]) || "N/A",
        bathrooms:
          this.readFact(typed, [
            "numberOfBathroomsTotal",
            "numberOfBathrooms",
          ]) || "N/A",
        squareFeet: this.readFact(typed, ["floorSize", "livingArea"]) || "N/A",
        yearBuilt: this.readFact(typed, ["yearBuilt"]) || "N/A",
        lotSize: this.readFact(typed, ["lotSize"]) || "N/A",
        price: this.readFact(typed, ["price"]) || "N/A",
      };
    }

    for (const child of Object.values(typed)) {
      const found = this.extractFromJson(child);
      if (found) {
        return found;
      }
    }

    return null;
  }

  readFact(source, keys) {
    for (const key of keys) {
      const value = source[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === "object") {
        if ("value" in value && value.value) {
          return String(value.value);
        }
        if ("name" in value && value.name) {
          return String(value.name);
        }
      }
      if (value !== "") {
        return String(value);
      }
    }
    return null;
  }

  tryParseJson(raw) {
    try {
      return JSON.parse(raw.trim());
    } catch {
      return null;
    }
  }

  normalizeUrl(candidate) {
    try {
      const parsed = parseSafeHttpsUrl(candidate.replace(/\\u002F/g, "/"), {
        allowedHostSuffixes: IMAGE_HOST_SUFFIXES,
      });
      return parsed.toString();
    } catch {
      return null;
    }
  }

  buildFallbackDetails(url) {
    try {
      const parsed = new URL(url);
      return {
        address: "Property from listing URL",
        city: parsed.hostname,
        state: "Unknown",
        zipCode: "Unknown",
        propertyType: "Property",
        bedrooms: "N/A",
        bathrooms: "N/A",
        squareFeet: "N/A",
        yearBuilt: "N/A",
        lotSize: "N/A",
        price: "N/A",
      };
    } catch {
      return {
        address: "Property from listing URL",
        city: "Unknown",
        state: "Unknown",
        zipCode: "Unknown",
        propertyType: "Property",
        bedrooms: "N/A",
        bathrooms: "N/A",
        squareFeet: "N/A",
        yearBuilt: "N/A",
        lotSize: "N/A",
        price: "N/A",
      };
    }
  }
}

module.exports = ListingScraperService;
