# Production Launch Checklist

Use this as the final gate before publishing Hackmarket to real users. The app is designed for a Vercel frontend, Render API, Render worker, Render Postgres, Render Key Value Redis, and Render-hosted seller tools.

## 1. Rotate Exposed Secrets

Rotate the Clerk secret key that was pasted into chat before launch. Treat it as compromised even if the app is still in test mode.

Rotate or create production values for:
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `CLERK_ISSUER_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `OPENROUTER_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `CONVERTER_SECRET`
- `TOOL_GATEWAY_SIGNING_PRIVATE_KEY`
- `RENDER_API_KEY`
- `GHCR_TOKEN`
- `ALERT_WEBHOOK_URL`

Store live values only in Vercel, Render, Stripe, Clerk, AWS, GitHub, or a proper secret manager. Do not commit live secrets into this repository.

## 2. Configure Vercel

Deploy `apps/web` as the frontend.

Required production env vars:
- `NEXT_PUBLIC_API_URL=https://api.hackmarket.io/v1`
- `NEXT_PUBLIC_APP_URL=https://hackmarket.io`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Attach domains:
- `hackmarket.io`
- `www.hackmarket.io`

## 3. Configure Render

Apply the Blueprint in `render.yaml`. It should create:
- `start`: FastAPI web service
- `start-worker`: ARQ background worker
- `hackmarket-redis`: Render Key Value Redis
- `hackmarket-db`: Render Postgres
- `home-accessibility-checker`: bundled seller tool service

Do not launch production on free tiers. The repository readiness check enforces starter/basic plans in `render.yaml`, but you still need to confirm live Render services match the Blueprint.

Confirm `hackmarket-redis` uses `maxmemoryPolicy=noeviction`. An eviction policy can silently discard queued uploads, usage records, or verified Stripe events.

Required production alert env vars:
- `ALERT_WEBHOOK_URL`
- `ALERT_WEBHOOK_TIMEOUT_SECONDS=5`
- `ALERT_DEDUPE_TTL_SECONDS=900`
- `ALERT_QUEUE_DEPTH_THRESHOLD=100`
- `ALERT_PROCESSING_JOB_STALE_AFTER_SECONDS=1800`
- `ALERT_FAILED_PROCESSING_JOBS_THRESHOLD=3`
- `ALERT_FAILED_PROCESSING_JOBS_WINDOW_SECONDS=900`
- `ALERT_STRIPE_WEBHOOK_STALE_AFTER_SECONDS=900`
- `ALERT_FAILED_STRIPE_WEBHOOKS_THRESHOLD=1`
- `ALERT_FAILED_STRIPE_WEBHOOKS_WINDOW_SECONDS=900`
- `STRIPE_WEBHOOK_JOB_EXPIRES_SECONDS=604800`
- `USAGE_LOG_JOB_EXPIRES_SECONDS=604800`
- `GATEWAY_RATE_LIMIT_VIOLATION_ALERT_THRESHOLD=3`
- `GATEWAY_RATE_LIMIT_VIOLATION_WINDOW_SECONDS=3600`
- `MAX_ACTIVE_API_KEYS_PER_USER=10`

Generate the API-to-tool signing pair once:

```bash
python3 scripts/generate_tool_gateway_keys.py
```

The command creates `.gateway-signing-keys.env` with owner-only permissions and
does not print the private key. Configure the values as follows:

- Set `TOOL_GATEWAY_SIGNING_PRIVATE_KEY`, `TOOL_GATEWAY_SIGNING_KEY_ID`, and `TOOL_GATEWAY_SIGNATURE_TTL_SECONDS` on both `start` and `start-worker`.
- Set `HACKMARKET_GATEWAY_PUBLIC_KEY`, `HACKMARKET_GATEWAY_KEY_ID`, and `HACKMARKET_GATEWAY_SIGNATURE_TTL_SECONDS` on `home-accessibility-checker`.
- Keep `HACKMARKET_TOOL_SLUG=home-accessibility-checker` and `ALLOW_UNSIGNED_GATEWAY_REQUESTS=false` on the seller service.
- Never place `TOOL_GATEWAY_SIGNING_PRIVATE_KEY` on a seller-owned service. The public and private key IDs must match.
- Store the private key in a password manager or secret manager, then remove the local key file after Render is configured.

Attach the API domain:
- `api.hackmarket.io`

## 4. Run Database Migrations

After Render has a production database, run:

```bash
cd apps/api
alembic upgrade head
```

Confirm migration `0007_add_tool_processing_jobs.py` is applied so seller submissions have durable job status.
Confirm migration `0008_add_data_integrity_constraints.py` is applied so API key hashes and open buyer/tool purchases are protected by database uniqueness.
Confirm migration `0009_add_admin_audit_logs.py` is applied so admin actions have a durable audit trail.
Confirm migration `0010_clear_synthetic_curated_tool_metrics.py` is applied so seeded latency and uptime values are removed without overwriting measured usage data.
Confirm migration `0011_add_durable_stripe_webhooks.py` is applied so Stripe receipts, invoice references, payout references, reversal references, and usage-period uniqueness are durable.

Before running production migrations:
- Confirm Render Postgres backups are enabled.
- Take or identify a recent manual backup.
- Run `MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://... python3 scripts/check_alembic_migrations.py --upgrade` against a disposable Postgres database.
- Do not use the production `DATABASE_URL` for migration validation; the script should refuse production-like targets unless an explicit override is used for a known disposable database.
- Run `python3 scripts/check_migration_safety.py` and explicitly review any migration that uses destructive upgrade operations.
- Confirm the data-integrity migration reports no duplicate API key hashes or duplicate open buyer/tool purchases.
- Review `docs/database-operations-runbook.md`.

## 5. Configure Provider Webhooks

Clerk:
- Set webhook target to `https://api.hackmarket.io/v1/auth/webhook`
- Store the signing secret as `CLERK_WEBHOOK_SECRET`
- Store the issuer URL as `CLERK_ISSUER_URL` so API JWT validation is pinned to the production Clerk instance.

Stripe:
- Set webhook target to `https://api.hackmarket.io/v1/billing/webhook`
- Store the signing secret as `STRIPE_WEBHOOK_SECRET`
- Subscribe to checkout completion/expiration, payment-intent success/failure, invoice paid/payment-failed, refunds, and Connect account updates used by the application.
- Confirm a valid event returns quickly after its durable receipt is queued, while a queue outage returns an error so Stripe retries delivery.
- Test paid checkout, asynchronous payment success/failure, invoice payment failure, full refunds, and partial-refund payout holds/operator alerts.
- For a full refund, verify buyer access is revoked and a previously paid seller transfer is reversed exactly once.
- Confirm duplicate Stripe events and repeated worker scheduler runs do not create duplicate purchases, usage invoices, seller payouts, or transactions.

## 6. Verify Launch Gates

Run local repo checks:

```bash
python3 scripts/security_scan.py
python3 scripts/repo_hygiene_check.py
python3 scripts/production_readiness_check.py
python3 scripts/render_blueprint_report.py --check
```

Confirm dependency audits pass before tagging launch:

```bash
(cd apps/web && npm audit --audit-level=high)
(cd apps/seller-tools/home-accessibility-checker && npm audit --audit-level=high)
```

Confirm an unsigned request sent directly to the seller tool is rejected and a
buyer invocation routed through the Hackmarket gateway succeeds. This proves
seller provider usage cannot bypass platform authentication and billing.

Run the live smoke test after DNS and deploys are active:

```bash
python3 scripts/production_smoke_check.py \
  --app-url https://hackmarket.io \
  --api-url https://api.hackmarket.io
```

This must pass public page checks, dashboard/admin/approver auth boundaries,
frontend/API security headers, `/health`, `/ready`, production CORS, public tool
discovery, structured protected-route API errors with request IDs, and the
submission status page.

Run the launch load smoke after the basic smoke test passes:

```bash
python3 scripts/production_load_smoke_check.py \
  --api-url https://api.hackmarket.io \
  --requests 40 \
  --concurrency 8 \
  --max-error-rate 0.02 \
  --max-p95-ms 1500 \
  --max-ms 5000
```

If a test buyer API key and live test tool are available, include a gateway
invocation load smoke before inviting users:

```bash
GATEWAY_API_KEY=hm_live_... GATEWAY_TOOL_SLUG=home-accessibility-checker \
  python3 scripts/production_load_smoke_check.py \
  --api-url https://api.hackmarket.io \
  --requests 40 \
  --concurrency 8
```

Optional signed-in smoke checks:

```bash
CLERK_SESSION_TOKEN=... python3 scripts/production_smoke_check.py \
  --app-url https://hackmarket.io \
  --api-url https://api.hackmarket.io
```

Optional admin smoke checks:

```bash
ADMIN_SESSION_TOKEN=... python3 scripts/production_smoke_check.py \
  --app-url https://hackmarket.io \
  --api-url https://api.hackmarket.io
```

## 7. Monitor Before Inviting Users

Watch these signals during the first launch window:
- API `/health` and `/ready`
- Seller tool `/health` and `/ready`; readiness must fail when its OpenRouter key is missing
- Worker health key reported by `/ready`
- `/ready` must return `degraded` if the worker heartbeat is missing, queue depth is above threshold, processing jobs are stuck, Stripe webhooks are stuck, or recent failure thresholds are crossed.
- Redis queue depth
- Failed `tool_processing_jobs`
- Alert webhook deliveries for worker failures, readiness degradation, and invalid provider webhooks
- Gateway rate-limit abuse alerts and active API-key caps
- Stripe webhook failures
- Usage-ledger retry failures (`usage_log_processing_failed`) and degraded synchronous writes (`usage_log_persistence_degraded`)
- Clerk webhook failures
- Seller tool deployment failures
- API 5xx rate
- Gateway latency and failed buyer invocations

Do not invite real users until uploads, dashboard status updates, buyer API key creation, tool discovery, and gateway invocation pass against production.

## 8. Operator Readiness

Before opening the marketplace, sign in with an admin account and verify:
- `/admin` loads the production health panel, audit trail, users, and processing jobs.
- The Stripe event queue lists recent event metadata without exposing raw payloads, and a failed test event can be retried from `/admin`.
- Suspended users can no longer access authenticated API paths.
- Failed processing jobs can be retried from `/admin`.
- Tool review changes, user moderation changes, and processing-job retries appear in the `/admin` audit trail.
- `/approver` can approve, reject, pause, and feature submitted tools.

## 9. Trust Pages

Review these pages before public launch and replace product-copy placeholders with counsel-approved language:
- `/pricing`
- `/terms`
- `/privacy`
- `/seller-agreement`
- `/support`
