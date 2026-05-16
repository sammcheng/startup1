# Render Monorepo Runbook

This repo uses Render for two separate web services:

- `start` (backend API)
- `home-accessibility-checker` (seller tool)

Both services live inside a monorepo, so their Render settings must match
`/Users/sammcheng/Desktop/startup/hackmarket/render.yaml`.

## Why This Matters

If either service is created or edited directly in the Render dashboard with an
empty root directory, Render treats the entire repo as that service's source.
That can cause unrelated commits to redeploy both services and create transient
`502 Bad Gateway` windows during builds.

## Source Of Truth

Use the repo Blueprint as the intended configuration:

- `/Users/sammcheng/Desktop/startup/hackmarket/render.yaml`

You can print the expected service settings with:

```bash
cd /Users/sammcheng/Desktop/startup/hackmarket
python3 scripts/render_blueprint_report.py
```

You can validate the guarded settings locally with:

```bash
cd /Users/sammcheng/Desktop/startup/hackmarket
python3 scripts/render_blueprint_report.py --check
```

CI also runs this check so root directories, build filters, and the pinned seller
tool Node version do not silently drift.

## Expected Settings

### `start`

- Root Directory: `apps/api`
- Runtime: `docker`
- Dockerfile Path: `./Dockerfile`
- Docker Context: `.`
- Health Check Path: `/health`
- Auto Deploy Trigger: `checksPass`
- Build Filter Paths:
  - `apps/api/**`

### `home-accessibility-checker`

- Root Directory: `apps/seller-tools/home-accessibility-checker`
- Runtime: `node`
- Node Version: `22.16.0` (pinned via `.node-version` and `package.json`)
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/health`
- Auto Deploy Trigger: `checksPass`
- Build Filter Paths:
  - `apps/seller-tools/home-accessibility-checker/**`

## Manual Dashboard Repair

For each service in Render:

1. Open the service Settings page.
2. Update the Root Directory to match the values above.
3. Update any path-sensitive command fields so they are relative to the new root.
4. Set the Health Check Path to `/health`.
5. Set Auto Deploy to run only after checks pass.
6. Add the listed Build Filter paths.
7. Save changes and confirm the preview of updated commands looks correct.

## If Dashboard Services Drift Too Far

If an existing dashboard-managed service does not reliably adopt the Blueprint
settings, the safer cleanup path is:

1. Ensure required environment variables are present in Render.
2. Re-create the service from the Blueprint so Render uses `render.yaml` as the
   source of truth.
3. Confirm health checks pass before deleting the old service.

## Verification

After any Render settings change:

```bash
curl -fsS https://start-3lbd.onrender.com/health
curl -fsS https://home-accessibility-checker.onrender.com/health
```

Then confirm an unrelated frontend-only commit no longer redeploys both Render
services.
