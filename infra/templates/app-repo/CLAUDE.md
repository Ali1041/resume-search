# CLAUDE.md — Working in this repo

This app deploys to Azure App Service through the platform's deployment automation.
Keep this file short and follow it exactly.

## Git flow: branches map to environments

- `main` = **production**. Merging into `main` deploys the production app and runs database migrations against the **production** database.
- `staging` = **staging**. Merging into `staging` deploys the staging app/slot and runs migrations against the **staging** database.
- Daily work: `feature/<short-name>` branch → PR into `staging` → verify on the staging URL → PR `staging` into `main`.
- Always `git pull origin <branch>` before starting work on it.
- **Never push directly to `main` or `staging`.** Never commit secrets (`.env`, API keys, connection strings).

## The deployment contract: `azure-deploy.json`

The file `azure-deploy.json` at the repo root tells the platform how to run this app.

| Field | What it does |
|---|---|
| `version` | Always `"1"`. |
| `runtime` | `node` or `python`. |
| `runtime_version` | Optional. e.g. `"20-lts"` (node) or `"3.11"` (python). Omit for platform default. |
| `startup_command` | Optional for node, **required for python**. e.g. `gunicorn --bind 0.0.0.0:8000 app:server`. |
| `build_command` | Optional build hint for CI. |
| `db_migration_command` | Optional. Command CI runs before each deploy to apply migrations, e.g. `npm run db:push`. Runs against the target branch's database (staging → staging DB, main → prod DB). |
| `health_check_path` | Optional, default `/health`. Must return HTTP 200 when the app is up — the deploy smoke test hits it. |
| `app_settings` | Non-secret environment variables ONLY. |
| `kv_secrets` | Map of `ENV_VAR_NAME` → Key Vault secret name for secrets. |

## Secrets — the rules

Two ways to give the app a secret (pick per environment):

1. **Plain env var (staging/dev only):** put it in `app_settings`, e.g.
   `"DATABASE_URL": "mysql://.../app_staging"`. Simple, but the value is visible
   in the Azure portal and Terraform state. Never for production.
2. **Key Vault (production):**
   1. Ask the operator to create it: `az keyvault secret set --vault-name <app-vault> --name <secret-name> --value <value>`.
   2. Declare it in `kv_secrets`: `"DATABASE_URL": "database-url"`.
   3. The platform injects it as a Key Vault reference. The app reads it as a normal env var.
   4. Rotating a secret? The app caches Key Vault references — **restart the app after rotation**.

- **NEVER** commit a secret to the repo (code, `.env`, or any file).
- If the app has a database, the operator also creates two **repo secrets** so CI can run migrations: `DATABASE_URL_STAGING` and `DATABASE_URL_PRODUCTION`.
- All GitHub-side secrets are created **manually by the operator** — the deployment automation manages Azure resources only and never touches GitHub secrets.

## Database migrations — the rules

- Migrations run **automatically in CI on every merge** (via `db_migration_command`), BEFORE the new code goes live.
- They must be **backward-compatible** (expand/contract): the old code keeps running while migrations apply. Add columns/tables first, remove in a later release.
- **Forward-only**: never edit or delete an applied migration. Fix a bad one with a new migration.
- Generate, don't hand-write (drizzle: `drizzle-kit generate && drizzle-kit migrate`).

## Adding a database dependency

Adding `drizzle`, `prisma`, `knex`, `sqlalchemy`, `psycopg2`, or `asyncpg` to the repo
changes the deployment: preflight will REFUSE to deploy until a `kv_secrets` entry
declares the connection string. Coordinate with the operator BEFORE merging.

## What happens on merge

1. GitHub Actions installs deps and builds (zip artifact).
2. If `db_migration_command` is set, migrations run against the target branch's database.
3. The zip is deployed to the matching Azure Web App (or staging slot) with OIDC — no stored credentials.
4. The health check path must return 200 or the deploy is treated as failed.

## Hard boundaries (out of contract — ask the operator first)

No monorepos (pnpm workspaces/turbo/lerna), no Dockerfiles, no background workers
(Procfile `worker:`, celery, dramatiq). These need a human-designed deployment.
