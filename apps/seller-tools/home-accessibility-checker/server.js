/**
 * Express.js Backend for Accessibility Checker
 * Production-ready HTTP service for image and listing-based accessibility analysis.
 */

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { getRuntimeConfig, allowedMimeTypes } = require("./config");
const { createLogger } = require("./logger");

const { port: PORT } = getRuntimeConfig();
const logger = createLogger({ service: "seller-tool-server" });

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function formatByteLimit(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10}KB`;
  }
  return `${bytes} bytes`;
}

function formatRetryAfterMinutes(windowMs) {
  const minutes = Math.ceil(windowMs / 60000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function getRetryAfterSeconds(windowMs) {
  return Math.ceil(windowMs / 1000);
}

// Lazily instantiate heavier services so health checks can respond sooner on cold start.
let comprehensiveAnalysisService;
let imageService;
let listingScraperService;
let validationService;

function getComprehensiveAnalysisService() {
  if (!comprehensiveAnalysisService) {
    const ComprehensiveAnalysisService = require("./services/comprehensive-analysis-service");
    comprehensiveAnalysisService = new ComprehensiveAnalysisService();
  }
  return comprehensiveAnalysisService;
}

function getImageService() {
  if (!imageService) {
    const ImageService = require("./services/image-service");
    imageService = new ImageService();
  }
  return imageService;
}

function getListingScraperService() {
  if (!listingScraperService) {
    const ListingScraperService = require("./services/listing-scraper-service");
    listingScraperService = new ListingScraperService();
  }
  return listingScraperService;
}

function getValidationService() {
  if (!validationService) {
    const ValidationService = require("./services/validation-service");
    validationService = new ValidationService();
  }
  return validationService;
}

async function withTimeout(promise, timeoutMs, createError) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function createAnalysisTimeoutError(timeoutMs) {
  const error = new Error(`Analysis timed out after ${timeoutMs}ms`);
  error.statusCode = 504;
  error.publicError = "Analysis timed out";
  return error;
}

function buildErrorResponse(req, error, extras = {}) {
  return {
    error,
    requestId: req.requestId,
    ...extras,
  };
}

function sendErrorResponse(req, res, statusCode, error, extras = {}) {
  return res.status(statusCode).json(buildErrorResponse(req, error, extras));
}

function sendValidationError(req, res, validationError) {
  return sendErrorResponse(req, res, 400, "Invalid request", {
    details: validationError.details,
  });
}

function sendMissingImagesError(req, res) {
  return sendErrorResponse(req, res, 400, "No images provided", {
    message: "Please upload at least one image",
  });
}

function sendNoProcessedImagesError(req, res) {
  return sendErrorResponse(req, res, 400, "No valid images processed", {
    message: "All uploaded images failed processing",
  });
}

function buildCorsOptions(allowedOrigins) {
  if (allowedOrigins.includes("*")) {
    return {
      origin: true,
      credentials: false,
    };
  }

  const allowedOriginSet = new Set(allowedOrigins);
  return {
    origin(origin, callback) {
      if (!origin || allowedOriginSet.has(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error("Origin not allowed by CORS");
      error.statusCode = 403;
      error.publicError = "Origin not allowed";
      error.userMessage =
        "This origin is not allowed to access the accessibility checker.";
      callback(error);
    },
    credentials: true,
  };
}

function respondWithHandledError(
  req,
  res,
  error,
  fallbackError,
  fallbackMessage,
  logMessage,
) {
  if (error.statusCode) {
    return sendErrorResponse(
      req,
      res,
      error.statusCode,
      error.publicError || fallbackError,
      {
        message: error.userMessage || error.message,
      },
    );
  }

  logger.error(logMessage, { error: error.message, stack: error.stack });
  return sendErrorResponse(req, res, 500, fallbackError, {
    message: fallbackMessage,
  });
}

function cleanupFileIfPresent(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logger.warn("Temporary file cleanup failed", {
      filePath,
      error: error.message,
    });
  }
}

async function processUploadedFiles(files) {
  const imageService = getImageService();
  const processedImages = [];

  for (const file of files) {
    let optimizedPath = file.path;
    try {
      optimizedPath = await imageService.optimizeImage(file.path);
      const base64Image = await imageService.convertToBase64(optimizedPath);

      processedImages.push({
        filename: file.originalname,
        base64: base64Image,
        size: file.size,
        mimetype: file.mimetype,
      });
    } catch (error) {
      logger.error("Error processing image", {
        filename: file.originalname,
        error: error.message,
      });
    } finally {
      cleanupFileIfPresent(file.path);
      if (optimizedPath !== file.path) {
        cleanupFileIfPresent(optimizedPath);
      }
    }
  }

  return processedImages;
}

function logAnalysisCompletion(finalResult, label) {
  logger.info(label, {
    score: finalResult.analysis.overall_score,
    imageCount: finalResult.analysis.analyzed_images,
  });
}

function createAnalyzeHandler({
  requestLabel,
  completionLabel,
  errorLabel,
  analysisTimeoutMs,
  analyzeRequest,
}) {
  return async (req, res) => {
    try {
      const validationService = getValidationService();
      logger.info(requestLabel, { ip: req.ip });

      const validationResult = validationService.validateAnalyzeRequest(
        req.body,
      );
      if (validationResult.error) {
        return sendValidationError(req, res, validationResult.error);
      }

      const finalResult = await withTimeout(
        analyzeRequest(validationResult.value),
        analysisTimeoutMs,
        () => createAnalysisTimeoutError(analysisTimeoutMs),
      );

      logAnalysisCompletion(finalResult, completionLabel);
      res.json(finalResult);
    } catch (error) {
      respondWithHandledError(
        req,
        res,
        error,
        "Analysis failed",
        "Internal server error during analysis",
        errorLabel,
      );
    }
  };
}

function createApp() {
  const runtimeConfig = getRuntimeConfig();
  const {
    rateLimitWindowMs,
    rateLimitMaxRequests,
    maxFileSize,
    maxFiles,
    uploadDir,
    analysisTimeoutMs,
    allowedOrigins,
  } = runtimeConfig;

  ensureDirectoryExists(uploadDir);
  const app = express();
  const allowedFileExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        ensureDirectoryExists(uploadDir);
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
      },
    }),
    limits: {
      fileSize: maxFileSize,
      files: maxFiles,
    },
    fileFilter: (req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const isAllowedMimeType = allowedMimeTypes.includes(file.mimetype);
      const isAllowedExtension = allowedFileExtensions.has(extension);

      if (isAllowedMimeType && isAllowedExtension) {
        cb(null, true);
        return;
      }

      cb(new Error("Only image files (JPEG, PNG, WebP) are allowed!"));
    },
  });

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const requestId = req.header("X-HackMarket-Request-Id") || uuidv4();
    req.requestId = requestId;
    res.setHeader("X-HackMarket-Request-Id", requestId);
    const originalWriteHead = res.writeHead.bind(res);

    res.writeHead = (...args) => {
      const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);
      res.setHeader(
        "X-HackMarket-Response-Time-Ms",
        String(Math.max(1, elapsedMs)),
      );
      return originalWriteHead(...args);
    };

    res.on("finish", () => {
      const elapsedMs = Number((process.hrtime.bigint() - start) / 1000000n);
      logger.info("request completed", {
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        responseTimeMs: Math.max(1, elapsedMs),
      });
    });

    next();
  });

  // Security middleware
  app.use(helmet());
  app.use(cors(buildCorsOptions(allowedOrigins)));

  // Logging middleware
  app.use(
    morgan("combined", {
      stream: { write: (message) => logger.info(message.trim()) },
    }),
  );

  // Rate limiting
  const limiter = rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMaxRequests,
    handler: (req, res) => {
      res.setHeader(
        "Retry-After",
        String(getRetryAfterSeconds(rateLimitWindowMs)),
      );
      sendErrorResponse(
        req,
        res,
        429,
        "Too many requests from this IP, please try again later.",
        {
          retryAfter: formatRetryAfterMinutes(rateLimitWindowMs),
        },
      );
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api/", limiter);

  // Body parsing middleware
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "1.0.0",
    });
  });

  // Upload endpoint
  app.post(
    "/api/upload",
    upload.array("images", maxFiles),
    async (req, res) => {
      try {
        logger.info("Upload request received", {
          fileCount: req.files?.length || 0,
          ip: req.ip,
        });

        if (!req.files || req.files.length === 0) {
          return sendMissingImagesError(req, res);
        }

        const processedImages = await processUploadedFiles(req.files);
        if (processedImages.length === 0) {
          return sendNoProcessedImagesError(req, res);
        }

        res.json({
          success: true,
          message: "Images uploaded successfully",
          images: processedImages.map((img) => ({
            filename: img.filename,
            size: img.size,
            mimetype: img.mimetype,
          })),
          count: processedImages.length,
        });
      } catch (error) {
        respondWithHandledError(
          req,
          res,
          error,
          "Upload failed",
          "Internal server error during image upload",
          "Upload error",
        );
      }
    },
  );

  // Analyze endpoint
  app.post(
    "/api/analyze",
    createAnalyzeHandler({
      requestLabel: "Analysis request received",
      completionLabel: "Analysis completed",
      errorLabel: "Analysis error",
      analysisTimeoutMs,
      analyzeRequest: analyzeAccessibilityRequest,
    }),
  );

  // Root endpoint for Hackmarket gateway compatibility
  app.post(
    "/",
    limiter,
    createAnalyzeHandler({
      requestLabel: "Root analysis request received",
      completionLabel: "Root analysis completed",
      errorLabel: "Root analysis error",
      analysisTimeoutMs,
      analyzeRequest: analyzeAccessibilityRequest,
    }),
  );

  // Combined upload and analyze endpoint
  app.post(
    "/api/upload-and-analyze",
    upload.array("images", maxFiles),
    async (req, res) => {
      try {
        const comprehensiveAnalysisService = getComprehensiveAnalysisService();
        logger.info("Upload and analyze request received", {
          fileCount: req.files?.length || 0,
          ip: req.ip,
        });

        if (!req.files || req.files.length === 0) {
          return sendMissingImagesError(req, res);
        }

        const processedImages = await processUploadedFiles(req.files);
        if (processedImages.length === 0) {
          return sendNoProcessedImagesError(req, res);
        }

        const finalResult = await withTimeout(
          comprehensiveAnalysisService.analyzeImages(processedImages),
          analysisTimeoutMs,
          () => createAnalysisTimeoutError(analysisTimeoutMs),
        );

        res.json(finalResult);
      } catch (error) {
        respondWithHandledError(
          req,
          res,
          error,
          "Processing failed",
          "Internal server error during upload and analysis",
          "Upload and analyze error",
        );
      }
    },
  );

  // Web scraping endpoint using Python scraper
  app.post("/api/scrape", async (req, res) => {
    try {
      const validationService = getValidationService();
      logger.info("Scraping request received", {
        url: req.body.url,
        ip: req.ip,
      });

      const validationResult = validationService.validateScrapeRequest(
        req.body,
      );
      if (validationResult.error) {
        return sendValidationError(req, res, validationResult.error);
      }

      const { url, maxImages = 10 } = validationResult.value;
      const result = await scrapeImagesWithPython(url, maxImages);

      if (result.images.length === 0) {
        return sendErrorResponse(req, res, 404, "No images found", {
          message: "No images could be scraped from the provided URL",
        });
      }

      res.json({
        success: true,
        message: `Successfully scraped ${result.images.length} images`,
        images: result.images,
        propertyDetails: result.propertyDetails || {},
        count: result.images.length,
        url,
      });
    } catch (error) {
      respondWithHandledError(
        req,
        res,
        error,
        "Scraping failed",
        "Internal server error during image scraping",
        "Scraping error",
      );
    }
  });

  async function analyzeAccessibilityRequest(payload) {
    const comprehensiveAnalysisService = getComprehensiveAnalysisService();
    const images = await resolveImagesForAnalysis(payload);
    const finalResult =
      await comprehensiveAnalysisService.analyzeImages(images);

    if (payload.url) {
      finalResult.source = {
        type: "url",
        url: payload.url,
        scraped_images: images.length,
      };
    } else {
      finalResult.source = {
        type: "images",
        uploaded_images: images.length,
      };
    }

    return finalResult;
  }

  async function resolveImagesForAnalysis(payload) {
    const imageService = getImageService();
    if (Array.isArray(payload.images) && payload.images.length > 0) {
      return payload.images;
    }

    let scrapeResult;
    try {
      scrapeResult = await scrapeImagesWithPython(
        payload.url,
        payload.maxImages || 10,
      );
    } catch (scrapeError) {
      const error = new Error(
        scrapeError.userMessage ||
          "We could not fetch listing images from that URL. Try uploading photos directly instead.",
      );
      error.statusCode = scrapeError.statusCode || 502;
      error.publicError = scrapeError.publicError || "Listing fetch failed";
      throw error;
    }

    if (!scrapeResult.images.length) {
      const error = new Error(
        "No images could be scraped from the provided URL",
      );
      error.statusCode = 404;
      error.publicError = "No images found";
      throw error;
    }

    const processedImages = [];
    for (const [index, image] of scrapeResult.images.entries()) {
      try {
        processedImages.push(
          await imageService.fetchImageAsPayload(image.url, index),
        );
      } catch (error) {
        logger.warn("Skipping scraped image that failed to download", {
          imageUrl: image.url,
          index,
          error: error.message,
        });
      }
    }

    if (!processedImages.length) {
      const error = new Error(
        "Scraped listing images could not be downloaded for analysis",
      );
      error.statusCode = 502;
      error.publicError = "Scraped images unavailable";
      throw error;
    }

    return processedImages;
  }

  // Helper function to call Python scraper
  async function scrapeImagesWithPython(url, maxImages) {
    const listingScraperService = getListingScraperService();
    logger.info("Calling listing scraper", {
      url,
      maxImages,
    });
    return await listingScraperService.scrape(url, maxImages);
  }

  // Error handling middleware
  app.use((error, req, res, _next) => {
    logger.error("Unhandled error", {
      error: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
    });

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return sendErrorResponse(req, res, 400, "File too large", {
          message: `File size must be less than ${formatByteLimit(maxFileSize)}`,
        });
      }
      if (error.code === "LIMIT_FILE_COUNT") {
        return sendErrorResponse(req, res, 400, "Too many files", {
          message: `Maximum ${maxFiles} files allowed`,
        });
      }
    }

    if (error.statusCode) {
      return sendErrorResponse(
        req,
        res,
        error.statusCode,
        error.publicError || "Request failed",
        {
          message: error.userMessage || error.message,
        },
      );
    }

    sendErrorResponse(req, res, 500, "Internal server error", {
      message: "An unexpected error occurred",
    });
  });

  // 404 handler
  app.use((req, res) => {
    sendErrorResponse(req, res, 404, "Not found", {
      message: "The requested endpoint does not exist",
    });
  });

  return app;
}

let server = null;

function startServer(port = PORT) {
  const app = createApp();
  server = app.listen(port, () => {
    logger.info(`Accessibility Checker API running on port ${port}`);
  });
  return server;
}

// Graceful shutdown
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown || !server) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer, gracefulShutdown };
