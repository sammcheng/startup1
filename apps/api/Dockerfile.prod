FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install -r requirements.txt gunicorn

COPY alembic.ini gunicorn.conf.py ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system hackmarket \
    && useradd --system --gid hackmarket --create-home --home-dir /home/hackmarket hackmarket

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app /app

RUN chmod +x /app/scripts/start-prod.sh \
    && chown -R hackmarket:hackmarket /app /home/hackmarket

USER hackmarket

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os, urllib.request; port = os.getenv('PORT', '8000'); urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3)" || exit 1

CMD ["/app/scripts/start-prod.sh"]
