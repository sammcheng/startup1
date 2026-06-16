#!/bin/sh
set -eu

echo "Running database migrations..."
alembic upgrade head

echo "Starting API with gunicorn..."
exec gunicorn app.main:app -c gunicorn.conf.py
