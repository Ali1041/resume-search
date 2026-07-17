# CLAUDE.md — Working in this repo

This app deploys to Azure App Service through GHR's deployment automation.
Keep this file short and follow it exactly.

## Git flow

- `main` is the **production** branch. Every push to `main` deploys to production automatically.
- Always `git pull origin main` before starting work.
- Create a feature branch per change (`feature/<short-name>`), open a PR to `main`.
- Never push directly to `main`. Never commit secrets (`.env`, API keys, connection strings).

## The deployment contract: `azure-deploy.json`

The file `azure-deploy.json` at the repo root tells the platform how to run this app.

| Field | What it does |
|---|---|
| `version` | Always `"1"`. |
| `runtime` | `node` or `python`. |
| `runtime_version` | Optional. e.g. `"20-lts"` (node) or `"3.11"` (python). Omit for platform default. |
| `startup_command` | Optional for node, **required for python**. e.g. `gunicorn --bind 0.0.0.0:8000 app:server`. |
| `build_command` | Optional build hint for CI. |
| `health_check_path` | Optional, default `/health`. Must return HTTP 200 when the app is up — the deploy smoke test hits it. |
| `app_settings` | Non-secret environment variables ONLY. |
| `kv_secrets` | Map of `ENV_VAR_NAME` → Key Vault secret name for secrets. |

## Secrets — the rules

- **NEVER** put a secret in `app_settings`, in code, or in any committed file.
- If the app needs a secret (database URL, API key):
  1. Ask the operator to create it: `az keyvault secret set --vault-name <app-vault> --name <secret-name> --value <value>`.
  2. Declare it in `kv_secrets`: `"DATABASE_URL": "database-url"`.
  3. The platform injects it as a Key Vault reference. The app reads it as a normal env var.
- Rotating a secret? The app caches Key Vault references — **restart the app after rotation**.

## Adding a database dependency

Adding `drizzle`, `prisma`, `knex`, `sqlalchemy`, `psycopg2`, or `asyncpg` to the repo
changes the deployment: preflight will REFUSE to deploy until a `kv_secrets` entry
declares the connection string. Coordinate with the operator BEFORE merging.

## What happens on push to `main`

1. GitHub Actions builds a zip (deps installed, `npm run build --if-present` for node).
2. The zip is deployed to the Azure Web App with OIDC (no stored credentials).
3. The health check path must return 200 or the deploy is treated as failed.

## Hard boundaries (out of contract — ask the operator first)

No monorepos (pnpm workspaces/turbo/lerna), no Dockerfiles, no background workers
(Procfile `worker:`, celery, dramatiq). These need a human-designed deployment.
