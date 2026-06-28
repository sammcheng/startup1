# Database Operations Runbook

Use this before launch, before schema changes, and during incidents. Render Postgres is the production source of truth for accounts, tools, purchases, usage logs, API keys, processing jobs, and billing metadata.

## Migration Safety

Before merging schema changes:

```bash
MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket_test \
  python3 scripts/check_alembic_migrations.py --upgrade
python3 scripts/check_migration_safety.py
```

The check must prove:
- Alembic has exactly one head.
- `alembic upgrade head` succeeds on a real Postgres database.
- The database reports the current revision as the head after upgrade.
- The target database is clearly disposable: local by default, not `ENVIRONMENT=production`, and named with a test/ci/temp/disposable marker.
- New `upgrade()` bodies do not include destructive Alembic operations or raw destructive SQL unless the migration is explicitly marked reviewed with `MIGRATION_SAFETY_REVIEWED = True`.
- Migration `0008_add_data_integrity_constraints.py` finds no duplicate API key hashes or duplicate open buyer/tool purchases before adding uniqueness constraints.

Production deploy rule:
- Run migrations before promoting traffic to code that depends on the new schema.
- Do not run destructive migrations without a verified backup and a rollback plan.
- Prefer additive migrations for launch-stage changes: add columns/tables first, deploy code, then remove old fields later.

## Backup Policy

Render Postgres must use a paid plan with backups enabled before inviting real users.

Minimum launch posture:
- Confirm automated backups are enabled in Render.
- Record the backup retention window.
- Take a manual backup before major schema changes.
- Verify restore into a non-production database at least once before launch.

## Restore Drill

Use a staging or disposable database. Never test restore against production.

1. Create or select a non-production Render Postgres instance.
2. Restore the selected production backup into that instance.
3. Point a temporary API environment at the restored database.
4. Run:

```bash
cd apps/api
alembic current
alembic upgrade head
```

5. Run API smoke checks against the temporary environment.
6. Confirm key tables exist and have expected rows:
- `users`
- `tools`
- `api_keys`
- `usage_logs`
- `transactions`
- `tool_purchases`
- `tool_processing_jobs`

## Rollback Notes

Code rollback is not the same as database rollback.

Safe rollback:
- Roll back code when the previous version still works with the current schema.
- Keep new columns nullable until the old code path is retired.
- Avoid renaming or dropping columns in the same deploy that introduces new code.

Unsafe rollback:
- Downgrading a production schema after writes may lose data.
- `alembic downgrade` should only be used after checking the migration and data-loss risk.

If a migration fails in production:
- Stop deployment promotion.
- Keep the current running API version online if possible.
- Inspect the failed Alembic revision and database state.
- Restore from backup only if the failed migration partially changed data in a way that cannot be safely repaired.

## Pre-Launch Gate

Before public launch, record evidence for:
- Latest Alembic revision.
- Data-integrity migration duplicate preflight passing.
- Render backup status and retention.
- Manual backup timestamp.
- Successful restore drill date.
- `python3 scripts/check_alembic_migrations.py --upgrade` passing in CI.
- Any remote disposable migration test must use `--allow-remote-database` intentionally and never point at production.
