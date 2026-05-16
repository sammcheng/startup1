#!/bin/sh
set -eu

BOOTSTRAP_TOOL_SEED="${ENABLE_BOOTSTRAP_TOOL_SEED:-false}"

echo "Running database migrations..."
alembic upgrade head

if [ "${BOOTSTRAP_TOOL_SEED}" = "true" ]; then
  echo "Seeding bootstrap marketplace data..."
  python -m app.bootstrap_seed
else
  echo "Skipping bootstrap marketplace seed (ENABLE_BOOTSTRAP_TOOL_SEED=${BOOTSTRAP_TOOL_SEED})."
fi

echo "Starting API with gunicorn..."
exec gunicorn app.main:app -c gunicorn.conf.py
