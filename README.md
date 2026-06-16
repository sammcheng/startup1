# Hackmarket

Hackmarket is a two-sided marketplace where sellers upload AI/API tools, buyers call them through a managed gateway, and the platform handles authentication, routing, usage tracking, billing, demos, and seller analytics.

**Architecture**
```text
                           +----------------------+
                           |     End Users        |
                           | buyers + sellers     |
                           +----------+-----------+
                                      |
                                      v
                         +------------+-------------+
                         |       Vercel Edge        |
                         |   TLS + Next.js web      |
                         +------+-------------+-----+
                                |             |
                hackmarket.io   |             | api.hackmarket.io
                                v             v
                      +---------+---+     +---+----------------+
                      | Next.js Web |     | FastAPI API        |
                      | dashboard   |     | gateway + auth     |
                      +-------------+     +---+----------------+
                                               |
                          +--------------------+--------------------+
                          |                    |                    |
                          v                    v                    v
                    PostgreSQL             Redis/ARQ          Render worker
                  users/tools/usage     rate limits,       tool processing,
                  billing metadata      counters, jobs     retries, billing
                          |
                          v
                     Seller tool services
                    Render-hosted runtimes
                          |
                          v
                       Stripe
               billing, invoices, payouts
```

**Project Overview**
- `apps/web`: Next.js 16 app router frontend for marketplace browsing, dashboards, demos, and docs
- `apps/api`: FastAPI backend for auth, tools, gateway, analytics, billing, and queued tool orchestration
- `packages/shared`: shared package space for future cross-app types/utilities
- `docker/templates`: templates used for seller tool containerization
- `nginx`: production reverse proxy configuration
- `scripts`: deployment and utility scripts

**Repository Layout**
```text
hackmarket/
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   └── shared/
├── docker/
│   └── templates/
├── nginx/
├── scripts/
├── docker-compose.prod.yml
└── .github/workflows/ci.yml
```

**Local Development**

Prerequisites:
- Node.js 22+
- Python 3.11+
- Docker and Docker Compose
- PostgreSQL 16+ and Redis 7+ if you are not using Docker locally

1. Copy environment variables
```bash
cp .env.example .env
```

2. Start local infrastructure
```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
```

3. Run the API
```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

4. Run the web app
```bash
cd apps/web
npm install
npm run dev
```

5. Open the apps
- Web: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`

**Running Tests**

Backend:
```bash
cd apps/api
pytest -v --tb=short
```

Frontend type checking:
```bash
cd apps/web
npm run type-check
```

Frontend lint:
```bash
cd apps/web
npm run lint
```

Frontend end-to-end tests:
```bash
cd apps/web
npm run test:e2e
```

**Production Deployment**

The production stack is defined with:
- `apps/api/Dockerfile.prod`
- `apps/web/Dockerfile.prod`
- `docker-compose.prod.yml`
- `nginx/nginx.conf`
- `scripts/deploy.sh`
- `render.yaml`

Typical deployment flow:
```bash
cp .env.example .env
./scripts/deploy.sh main
```

What the deploy script does:
1. Fetches and fast-forwards to the target git ref
2. Builds the production Docker images
3. Starts PostgreSQL, Redis, API, web, nginx, and certbot
4. Runs Alembic migrations
5. Performs a post-deploy health check
6. Rolls the code and containers back if the health check fails

Notes:
- Set `LETSENCRYPT_EMAIL` before first certificate bootstrap.
- `HEALTHCHECK_URL` can override the default API health endpoint during deployment.
- Database schema rollback is not automatic; the script only rolls back code and service versions.

Hosted deployment split:
- Vercel: deploy `apps/web` as the Next.js frontend
- Render: deploy `apps/api`, `start-worker`, and `apps/seller-tools/home-accessibility-checker` with `render.yaml`, plus managed Postgres and Key Value

Render monorepo note:
- `render.yaml` is configured to isolate the backend with `rootDir: apps/api`
- `render.yaml` is configured to run `start-worker` from the same API image with `dockerCommand: arq app.worker.WorkerSettings`
- `render.yaml` is configured to isolate the seller tool with `rootDir: apps/seller-tools/home-accessibility-checker`
- if an existing Render service was originally created from the dashboard, update that service to match the Blueprint settings or re-create it from the Blueprint so unrelated repo pushes stop redeploying both services
- see `/Users/sammcheng/Desktop/startup1/docs/render-monorepo-runbook.md` for the manual repair checklist

Recommended hosted env values:
- Vercel `NEXT_PUBLIC_API_URL=https://api.hackmarket.io/v1`
- Vercel `NEXT_PUBLIC_APP_URL=https://hackmarket.io`
- Render custom domain `api.hackmarket.io` pointed at the `start` service
- Render `CORS_ORIGINS=["https://hackmarket.io","https://www.hackmarket.io","https://web-six-dusky-20.vercel.app"]`
- Render `CORS_ORIGIN_REGEX=`
- Render `ALLOW_VERCEL_PREVIEW_ORIGINS=false`
- Render `CONVERTER_SECRET`: long random shared secret for converter-to-API imports
- Render `OPENROUTER_API_KEY`: required for production repo submission analysis
- Render `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`: required for durable source upload storage
- Render `WORKER_QUEUE_NAME=hackmarket:jobs` on both API and worker
- Render `RUN_BILLING_SCHEDULER_IN_API=false`; billing schedules run from the worker cron job
- Render `RENDER_TOOL_PLAN=starter` so dynamically hosted seller tools do not launch on free instances

Release verification after deploy:
1. Confirm frontend responds on the public Vercel URL and custom domain.
2. Confirm API `/health` and `/ready` return success from the live Render service.
3. Confirm the Render worker health check key appears in Redis and `/ready` reports queue depth.
4. Run a signed-in smoke test for `/dashboard`, tool purchase redirect, seller tool upload/configure, and `/submit/{id}/status`.
5. Confirm Clerk and Stripe webhooks deliver successfully with real provider events.

**CI/CD**

GitHub Actions workflow: `.github/workflows/ci.yml`

On pull requests and pushes to `main`, CI:
- installs backend dependencies
- runs backend tests
- installs frontend dependencies
- runs frontend type checking
- runs frontend linting
- validates the Render blueprint contract
- builds the production Docker images

On pushes to `main`, CI also pushes Docker images to GHCR as build artifacts. Production deploys are handled by Vercel Git integration for `apps/web` and Render auto-deploy for the services in `render.yaml`.

**Environment Variables**

Core application:
- `DEBUG`: enable debug behavior locally
- `ENVIRONMENT`: `development`, `test`, or `production`
- `OPENAI_API_KEY`: used for AI-assisted analysis features
- `CONVERTER_SECRET`: shared secret for internal converter import endpoints
- `OPENROUTER_API_KEY`: required in production for repo submission analysis
- `OPENROUTER_MODEL`: model used by repo submission analysis
- `ALLOW_REPO_ANALYSIS_FALLBACK`: keep `false` in production unless explicitly accepting heuristic analysis

Database:
- `DATABASE_URL`: SQLAlchemy async database URL
- `POSTGRES_DB`: production compose database name
- `POSTGRES_USER`: production compose database user
- `POSTGRES_PASSWORD`: production compose database password

Redis:
- `REDIS_URL`: Redis connection URL

Auth / Clerk:
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `CLERK_JWKS_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`

Stripe:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

AWS / storage:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`

Public web config:
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_APP_URL`

Deployment:
- `LETSENCRYPT_EMAIL`
- `HEALTHCHECK_URL`
- `CORS_ORIGINS`
- `CORS_ORIGIN_REGEX`
- `ALLOW_VERCEL_PREVIEW_ORIGINS`

**Operational Notes**
- Seller tool source archives live in S3 and are processed into runtime containers by the API service.
- Buyer calls always flow through the Hackmarket gateway, which applies auth, rate limiting, usage logging, and billing hooks.
- Redis currently backs hot-path counters, rate limiting, and port allocation.
- PostgreSQL remains the source of truth for tools, users, transactions, and analytics rollups.
