# Verified Runbook — Zero to Staging (human-followable, no LLM required)

**Provenance:** this runbook is the distilled, in-order recipe of the ACTUAL
Touchpoint staging run (2026-07-23), including every failure hit and its fix.
Times are measured from that run. Total: **~75 min** (most of it waiting on
Azure/CI), plus ~10 min of GitHub clicks.

**Decision points (human judgment, by design):** secrets entry, PR merges,
and the `--no-prod` choice. Everything else is copy-paste.

---

## Step 0 — Machine + access (~5 min, once)

**Prerequisite: `infra/NEW_ORG_CHECKLIST.md` Part 0 (Foundations) is complete —
accounts, access verified, decisions recorded. Do not start here without it.**

```bash
terraform --version          # >= 1.5
az login                     # browser auth; then: az account show --query name
pip3 install --user --break-system-packages jsonschema
git --version                # gh CLI NOT needed
```

Access you must already have: Contributor on the Azure subscription, MySQL
server admin credentials, push/admin on the GitHub org.

**Landmine 0a (macOS DNS):** if `az` commands fail with "Failed to resolve":
`sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`, verify with
`ping -c2 management.azure.com`.

## Step 1 — Terraform state storage (~5 min, once ever)

```bash
az group create -n rg-<org>-tfstate -l canadaeast
az storage account create -n st<org>tfstate -g rg-<org>-tfstate --sku Standard_LRS
az storage container create -n tfstate --account-name st<org>tfstate
```

Fill `infra/platform/backend.hcl` from `backend.hcl.example`; copy the same
values to `infra/app/backend.hcl` **minus the `key` line**.

## Step 2 — Platform apply (~4 min, once per org)

Edit `infra/platform/terraform.tfvars`: `location`, `app_service_sku="B1"`,
`staging_mode="app"` (Case B) — then:

```bash
terraform -chdir=infra/platform init -backend-config=backend.hcl -reconfigure
terraform -chdir=infra/platform apply     # type: yes
```

**Landmine 2a (stale state lock):** a killed apply leaves a lock —
`terraform -chdir=infra/platform force-unlock <lock-id>` (id is in the error).

## Step 3 — App repo files (~10 min, per app)

```bash
cd <app-repo> && git checkout main && git pull
cp <infra>/templates/app-repo/azure-deploy.json ./azure-deploy.json   # edit values
mkdir -p .github/workflows
cp <infra>/templates/app-repo/.github/workflows/deploy.yml ./.github/workflows/
# edit deploy.yml env: AZURE_WEBAPP_NAME, STAGING_MODE, RUNTIME, DB_MIGRATION_COMMAND
# (pnpm repos: the install step must be "npm install -g pnpm" — corepack's
#  integrity keys break on runners. Landmine 3a.)
git checkout -b staging && git push -u origin staging
git checkout -b chore/deployment-setup && git add -A && git commit -m "chore: deployment contract + CI" && git push -u origin HEAD
# open PR: staging ← chore/deployment-setup (merge LATER, step 8)
```

## Step 4 — Staging database (~10 min, per app with a DB)

```bash
# 4a. Create the DB on the existing server (creds = the server's admin login)
az mysql flexible-server db create --resource-group <server-rg> \
  --server-name <server> --database-name <app>_staging

# 4b. YOUR IP must be allowed — expected failure otherwise: "connect ETIMEDOUT"
az mysql flexible-server firewall-rule create --resource-group <server-rg> \
  --name <server> --rule-name local-temp \
  --start-ip-address $(curl -s ifconfig.me) --end-ip-address $(curl -s ifconfig.me)

# 4c. Migrations from the app repo
DATABASE_URL="mysql://<user>:<pass>@<server>.mysql.database.azure.com:3306/<app>_staging" \
  pnpm run db:push        # or: npm run db:push / alembic upgrade head
```

## Step 5 — Provision (~6 min, per app)

**CHOOSE:** prod+staging pair (new app) OR staging-only (`--no-prod`, app
already has prod elsewhere). Create ONLY what was requested.

```bash
export OPERATOR_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)
export BACKEND_CONFIG_ARGS="-backend-config=backend.hcl"
infra/scripts/deploy.sh deploy /path/to/<app-repo> \
  --app-name <org>-<app> --env staging --staging-mode app [--no-prod]
# type the app name at the gate
```

- **Landmine 5a:** `name 'X' is not globally available` → pick another name
  (preflight checks this early on purpose).
- **Expected:** smoke test fails with exit 2 — no code deployed yet. Fine.

## Step 6 — Secrets (~3 min, per app)

**Env-var mode (staging):** put `DATABASE_URL` in a LOCAL contract overlay
(never committed) and re-run step 5 with `--contract <overlay>`. The value then
lives only in the Azure app setting + Terraform state.
**Vault mode (prod):** `az keyvault secret set --vault-name <kv> --name database-url --value "..."`.
**Either way, CI migrations need a repo secret:** `DATABASE_URL_STAGING` (and
`DATABASE_URL_PRODUCTION` later) — set in step 8.

## Step 7 — OIDC (~5 min, once per org; done for GHR)

```bash
APP_ID=$(az ad app create --display-name <org>-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
SP_OID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

# one federated credential per repo+branch (staging AND main):
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "<repo>-staging", "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<org>/<repo>:ref:refs/heads/staging",
  "audiences": ["api://AzureADTokenExchange"]}'
# (repeat with refs/heads/main)

# SP can deploy to the app — nothing more:
az role assignment create --assignee-object-id "$SP_OID" \
  --assignee-principal-type ServicePrincipal --role "Website Contributor" \
  --scope "$(az webapp show -g rg-<org>-platform -n <app>-staging --query id -o tsv)"
# For future apps: export DEPLOY_SP_OBJECT_ID=$SP_OID and deploy.sh wires this.
```

**Never** give the SP a resource-group-level role (Key Vault management-plane
takeover path — documented in README §2.2).

## Step 8 — GitHub secrets + merge (~10 min)

```bash
# Org level (identifiers, shared by all repos):
#   AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID
# Repo level (per-app secrets):
#   DATABASE_URL_STAGING (and DATABASE_URL_PRODUCTION later)
```

Merge the PR from step 3 into `staging` → CI: build → migrate → deploy →
`https://<app>-staging.azurewebsites.net` live. 503 after green? Restart the app once.

## Step 9 — Verify (~2 min)

```bash
curl -I https://<app>-staging.azurewebsites.net
az webapp log tail -g rg-<org>-platform -n <app>-staging   # if anything's off
```

---

## Failure index (every one hit in the real run)

| # | Symptom | Fix |
|---|---|---|
| 0a | `az`: Failed to resolve host | DNS flush (step 0a) |
| 2a | state blob is already locked | `force-unlock <id>` |
| 3a | CI: Cannot find matching keyid (corepack) | `npm install -g pnpm` in workflow |
| 4a | `connect ETIMEDOUT` on migrate | firewall rule for your IP (step 4b) |
| 5a | name not globally available | pick another `--app-name` |
| 5b | azurerm v4: health_check_path requires eviction time | fixed in module (all future runs) |
| 5c | re-deploy blocked by name check | fixed: `--existing` auto-detected |
| 6a | secret accidentally committed | env-var overlay stays LOCAL, never in git |
| 8a | CI fails at azure/login | org secrets missing or federated subject mismatch (repos created after 2026-07-15: verify `sub` format) |
| 8b | Azure deploy shows wrong app name ("doesn't exist") | app was renamed at provision time (global uniqueness) but the workflow's `AZURE_WEBAPP_NAME` wasn't updated — rename and workflow must change in the same breath |
| 9a | Oryx build fails `ERESOLVE` on a pnpm repo | the template double-builds: CI uses pnpm (loose peers via `.npmrc`), Azure's Oryx rebuild uses npm (strict). Fix: `NPM_CONFIG_LEGACY_PEER_DEPS=true` app setting — deploy.sh now adds it automatically when `pnpm-lock.yaml` is present |
| 9b | Oryx build fails `vite: not found` (or similar) | `NODE_ENV=production` app setting makes the server-side npm SKIP devDependencies — the build tools (vite/esbuild) are devDeps. Fix: `NPM_CONFIG_PRODUCTION=false`. **Root cause of 9a+9b is the double-build itself (CI builds, Azure rebuilds). The structural fix is single-build: CI builds, server only extracts + runs — template v1.1 (below).** |
