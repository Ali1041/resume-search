# REGISTER.md — Getting a new app deployed

This is how a GHR app goes from "code on my machine" to "URL in the browser".

## The boundary: simple apps only

The automation deploys **single-runtime web apps** — one Node or Python process
serving HTTP. It does NOT provision databases, does NOT deploy monorepos
(pnpm workspaces, turbo, lerna), does NOT run background workers (Procfile
`worker:`, celery, dramatiq), and does NOT build custom Docker images. If your
app needs one of those, talk to the operator first — it gets a human-designed
deployment instead.

Using an **existing** database is fine: the connection string is injected via
Key Vault (see below).

## Steps

1. **Copy the template files into your repo root** (from the infra repo,
   `infra/templates/app-repo/`):
   - `azure-deploy.json` (Node) **or** `azure-deploy.python.json` → rename to `azure-deploy.json` (Python)
   - `CLAUDE.md`
   - `.github/workflows/deploy.yml`

2. **Fill in `azure-deploy.json`.** Required: `version` (`"1"`) and `runtime`
   (`node` or `python`). Python also requires `startup_command`. Keep secrets
   OUT of `app_settings`.

3. **If your app talks to a database**, ask the operator to create the secret
   first, then declare it in `kv_secrets`:
   ```json
   "kv_secrets": { "DATABASE_URL": "database-url" }
   ```
   (The operator runs `az keyvault secret set` once the app's vault exists.)
   Also set `db_migration_command` (e.g. `"npm run db:push"`) so schema changes
   apply automatically on every merge.

4. **Create the repo in the GHR GitHub org**, create a `staging` branch, and
   push your code. Branches map to environments:
   - merge into `staging` → deploys the staging app/slot + migrates the staging DB
   - merge into `main` → deploys the production app + migrates the production DB

5. **Send the repo URL to the operator (Ali).** He runs:
   ```
   infra/scripts/deploy.sh deploy https://github.com/GHR-ORG/your-app
   ```
   Preflight validates the repo, Terraform plans the resources, Ali confirms,
   the app is deployed, and a smoke test checks the health endpoint.

6. **You receive the URL(s).** The operator gives you:
   - production URL
   - staging URL (a deployment slot or a separate `-staging` app, depending on
     the platform configuration)
   - the app's Key Vault name (for secret requests)

7. **Wire up CI for ongoing deploys:** in `.github/workflows/deploy.yml`, set
   `AZURE_WEBAPP_NAME`, `STAGING_MODE`, `RUNTIME`, and (if the app has a DB)
   `DB_MIGRATION_COMMAND` to the values the operator gives you. If the app has a
   database, the operator also creates two repo secrets so migrations can run in
   CI: `DATABASE_URL_STAGING` and `DATABASE_URL_PRODUCTION`. From then on, every
   merge to `staging` or `main` deploys the matching environment automatically.

## If preflight refuses your app

Read the failure message — it names the exact file that is out of contract
(monorepo marker, Dockerfile, worker process, database without a declared
secret). Either bring the app back inside the contract or ask the operator for
a custom deployment.
