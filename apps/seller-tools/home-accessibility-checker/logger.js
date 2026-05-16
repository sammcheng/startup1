"use strict";

const winston = require("winston");

function createLogger({
  service,
  level = process.env.LOG_LEVEL || "info",
} = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test";

  return winston.createLogger({
    level,
    silent: isTest,
    defaultMeta: service ? { service } : undefined,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.Console({
        format:
          isProduction || isTest
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.simple(),
              ),
      }),
    ],
  });
}

module.exports = {
  createLogger,
};
