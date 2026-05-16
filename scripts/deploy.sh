#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
PREVIOUS_SHA="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
TARGET_REF="${1:-main}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://api.hackmarket.io/health}"

log() {
  printf '[deploy] %s\n' "$1"
}

rollback() {
  log "Health check failed. Rolling back to ${PREVIOUS_SHA}."
  git -C "${ROOT_DIR}" checkout --force "${PREVIOUS_SHA}"
  docker compose -f "${COMPOSE_FILE}" up -d --build
}

run_healthcheck() {
  log "Running health check against ${HEALTHCHECK_URL}"
  for attempt in {1..12}; do
    if curl -fsS --max-time 10 "${HEALTHCHECK_URL}" >/dev/null; then
      log "Health check passed."
      return 0
    fi
    sleep 5
  done
  return 1
}

ensure_certificates() {
  if [[ -z "${LETSENCRYPT_EMAIL:-}" ]]; then
    log "LETSENCRYPT_EMAIL not set. Skipping certificate bootstrap."
    return 0
  fi

  if docker volume inspect hackmarket_letsencrypt >/dev/null 2>&1; then
    :
  fi

  log "Starting nginx for ACME challenge handling."
  docker compose -f "${COMPOSE_FILE}" up -d nginx

  if docker compose -f "${COMPOSE_FILE}" run --rm certbot certonly \
    --webroot \
    -w /var/www/certbot \
    --email "${LETSENCRYPT_EMAIL}" \
    --agree-tos \
    --no-eff-email \
    -d hackmarket.io \
    -d www.hackmarket.io \
    -d api.hackmarket.io; then
    log "Certificates are present."
  else
    log "Certificate bootstrap skipped or failed; continuing with existing certs."
  fi
}

main() {
  cd "${ROOT_DIR}"

  trap 'rollback' ERR

  log "Fetching latest code."
  git fetch origin
  git checkout --force "${TARGET_REF}"
  git pull --ff-only origin "${TARGET_REF}"

  ensure_certificates

  log "Building and starting production services."
  docker compose -f "${COMPOSE_FILE}" build
  docker compose -f "${COMPOSE_FILE}" up -d postgres redis api web nginx certbot

  log "Running database migrations."
  docker compose -f "${COMPOSE_FILE}" exec -T api alembic upgrade head

  log "Refreshing services with the latest images."
  docker compose -f "${COMPOSE_FILE}" up -d api web nginx

  if ! run_healthcheck; then
    exit 1
  fi

  trap - ERR
  log "Deployment completed successfully."
}

main "$@"
