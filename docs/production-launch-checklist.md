# Production Launch Checklist

Use this as the final gate before publishing Hackmarket to real users. The app is designed for a Vercel frontend, Render API, Render worker, Render Postgres, Render Key Value Redis, and Render-hosted seller tools.

## 1. Rotate Exposed Secrets

Rotate the Clerk secret key that was pasted into chat before launch. Treat it as compromised even if the app is still in test mode.

Rotate or create production values for:
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `OPENROUTER_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `CONVERTER_SECRET`
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

Required production alert env vars:
- `ALERT_WEBHOOK_URL`
- `ALERT_WEBHOOK_TIMEOUT_SECONDS=5`
- `ALERT_QUEUE_DEPTH_THRESHOLD=100`
- `GATEWAY_RATE_LIMIT_VIOLATION_ALERT_THRESHOLD=3`
- `GATEWAY_RATE_LIMIT_VIOLATION_WINDOW_SECONDS=3600`
- `MAX_ACTIVE_API_KEYS_PER_USER=10`

Attach the API domain:
- `api.hackmarket.io`

## 4. Run Database Migrations

After Render has a production database, run:

```bash
cd apps/api
alembic upgrade head
```

Confirm migration `0007_add_tool_processing_jobs.py` is applied so seller submissions have durable job status.

## 5. Configure Provider Webhooks

Clerk:
- Set webhook target to `https://api.hackmarket.io/v1/auth/clerk/webhook`
- Store the signing secret as `CLERK_WEBHOOK_SECRET`

Stripe:
- Set webhook target to `https://api.hackmarket.io/v1/billing/webhook`
- Store the signing secret as `STRIPE_WEBHOOK_SECRET`
- Test checkout, subscription updates, failed payments, and refunds

## 6. Verify Launch Gates

Run local repo checks:

```bash
python3 scripts/production_readiness_check.py
python3 scripts/render_blueprint_report.py --check
```

Run the live smoke test after DNS and deploys are active:

```bash
python3 scripts/production_smoke_check.py \
  --app-url https://hackmarket.io \
  --api-url https://api.hackmarket.io
```

Optional signed-in smoke checks:

```bash
CLERK_SESSION_TOKEN=... python3 scripts/production_smoke_check.py \
  --app-url https://hackmarket.io \
  --api-url https://api.hackmarket.io
```

## 7. Monitor Before Inviting Users

Watch these signals during the first launch window:
- API `/health` and `/ready`
- Worker health key reported by `/ready`
- Redis queue depth
- Failed `tool_processing_jobs`
- Alert webhook deliveries for worker failures, readiness degradation, and invalid provider webhooks
- Gateway rate-limit abuse alerts and active API-key caps
- Stripe webhook failures
- Clerk webhook failures
- Seller tool deployment failures
- API 5xx rate
- Gateway latency and failed buyer invocations

Do not invite real users until uploads, dashboard status updates, buyer API key creation, tool discovery, and gateway invocation pass against production.

## 8. Operator Readiness

Before opening the marketplace, sign in with an admin account and verify:
- `/admin` loads users and processing jobs.
- Suspended users can no longer access authenticated API paths.
- Failed processing jobs can be retried from `/admin`.
- `/approver` can approve, reject, pause, and feature submitted tools.

## 9. Trust Pages

Review these pages before public launch and replace product-copy placeholders with counsel-approved language:
- `/pricing`
- `/terms`
- `/privacy`
- `/seller-agreement`
- `/support`
