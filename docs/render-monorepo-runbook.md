# Render Monorepo Runbook

Render must treat `render.yaml` as the source of truth for the production API,
worker, Redis instance, database, and seller tool. Dashboard-created services
can drift from the Blueprint and silently miss workers, secrets, health checks,
or paid-tier settings.

## Validate The Blueprint

From the repository root:

```bash
python3 scripts/render_blueprint_report.py --check
python3 scripts/production_readiness_check.py
```

CI runs both checks on every push to `main`.

## Expected Services

### `start`

- Type: web service
- Root directory: `apps/api`
- Runtime: Docker using `./Dockerfile`
- Plan: Starter
- Health check: `/ready`
- Auto-deploy: only after GitHub checks pass
- Build filter: `apps/api/**`

`/health` proves only that the process is alive. Render must use `/ready` so a
release receives traffic only after PostgreSQL and Redis are healthy. The same
response reports worker, queue, processing-job, and Stripe health, but those
operational warnings do not take the buyer API offline. Release smoke checks
still fail until all operational checks are healthy.

### `start-worker`

- Type: background worker
- Root directory: `apps/api`
- Runtime: Docker using `./Dockerfile`
- Command: `arq app.worker.WorkerSettings`
- Plan: Starter
- Shutdown delay: 300 seconds
- Auto-deploy: only after GitHub checks pass
- Build filter: `apps/api/**`

The API and worker must share the same database, Redis, queue name, signing
configuration, billing configuration, storage credentials, and provider keys.

### `home-accessibility-checker`

- Type: web service
- Root directory: `apps/seller-tools/home-accessibility-checker`
- Runtime: Node `22.16.0`
- Build command: `npm ci`
- Start command: `npm start`
- Plan: Starter
- Health check: `/ready`
- Auto-deploy: only after GitHub checks pass
- Build filter: `apps/seller-tools/home-accessibility-checker/**`

### Data Services

- `hackmarket-db`: Render Postgres on `basic-256mb` or larger, with backups enabled
- `hackmarket-redis`: Starter Key Value with `noeviction`

## Repair Dashboard Drift

1. Add every secret marked `sync: false` in `render.yaml` before deploying.
2. Sync the existing services from the Blueprint or recreate them from it.
3. Confirm the API and worker use the same environment group or equivalent values.
4. Confirm `start-worker` exists and its heartbeat is visible to `/ready`.
5. Keep the old API active until the replacement passes readiness checks.
6. Remove the old service only after authenticated production smoke tests pass.

Do not weaken production configuration validation to make a deployment start
without Clerk, Stripe, storage, model-provider, or gateway-signing credentials.

## Verify A Release

```bash
curl -fsS https://start-3lbd.onrender.com/health
curl -fsS https://start-3lbd.onrender.com/ready
curl -fsS https://home-accessibility-checker.onrender.com/ready
```

The API readiness response must include successful database, Redis, and worker
checks. Then run `scripts/production_smoke_check.py` and
`scripts/production_load_smoke_check.py` using the documented launch commands.
