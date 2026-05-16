#!/usr/bin/env bash
set -euo pipefail

# Sync the live Render services toward the repo's intended monorepo layout.
#
# This script only uses settings that the Render CLI can currently update.
# It intentionally does not try to manage fields the CLI doesn't expose.
#
# Usage:
#   ./scripts/render_sync_live_settings.sh

BACKEND_SERVICE_ID="srv-d7puroe8bjmc73bmfthg"
SELLER_SERVICE_ID="srv-d7q2b25ckfvc739f7al0"

echo "Updating backend service (${BACKEND_SERVICE_ID})..."
render services update "${BACKEND_SERVICE_ID}" \
  --root-directory apps/api \
  --health-check-path /health \
  --build-filter-path apps/api/** \
  --output json

echo
echo "Updating seller tool service (${SELLER_SERVICE_ID})..."
render services update "${SELLER_SERVICE_ID}" \
  --root-directory apps/seller-tools/home-accessibility-checker \
  --build-command "npm ci" \
  --start-command "npm start" \
  --health-check-path /health \
  --build-filter-path apps/seller-tools/home-accessibility-checker/** \
  --output json

echo
echo "Done. Verify with:"
echo "  curl -fsS https://start-3lbd.onrender.com/health"
echo "  curl -fsS https://home-accessibility-checker.onrender.com/health"
