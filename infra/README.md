# GHR Deployment Automation — Runbook

Terraform + GitHub Actions system that takes a GitHub repo URL and produces a
working Azure URL, with humans only where judgment is needed. This document is
the operator runbook ("the workings").

Plan of record: `docs/superpowers/specs/2026-07-17-ghr-deployment-automation.md`
(v2, post-review). All Critical/Major review findings are addressed in code here.

> **The boundary (deliberate, do not blur): automation touches AZURE ONLY.**
> Terraform and `deploy.sh` create and manage Azure resources — web apps, slots,
> Key Vaults, RBAC, app settings, and the Key Vault *references* that wire
> secrets into apps. Everything on the GITHUB side is **manual operator work,
> forever for now**: org secrets (`AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/
> `AZURE_SUBSCRIPTION_ID`), repo secrets (`DATABASE_URL_STAGING`/
> `DATABASE_URL_PRODUCTION`), OIDC federated credentials, the `env:` values in
> each app's workflow, branch creation, and branch protection. The scripts
> contain **no** GitHub secret management by design (verified: `gh` is used only
> for read-only repo clones). When you onboard an app, the GitHub-side steps are
> a checklist you run by hand — they are documented as manual commands in §2.2,
> §2.3, §3.1, and §4, never scripted.

```
infra/
├── platform/            # ONE-TIME shared infra (resource group + shared App Service Plan)
├── app/                 # PER-APP root — one terraform state per app (apps/<name>.tfstate)
├── modules/web-app/     # reusable per-app module (web app, slot/-staging app, Key Vault, App Insights)
├── schemas/             # JSON Schema (draft 2020-12) for azure-deploy.json
├── scripts/             # preflight.py (validator) + deploy.sh (the ONLY apply path in v1)
└── templates/app-repo/  # files copied into each new app repo
```

---

## 1. Architecture — the two staging scenarios

Both scenarios share ONE Linux App Service Plan in `canadacentral` hosting all
apps. Each app gets its own Key Vault (RBAC-only, purge protection, 90-day soft
delete) and its own Application Insights. The difference is how "staging" is
realised — a single variable `staging_mode` (`slot` or `app`) flows through the
platform root, the app root, the module, and the GitHub Actions template.

```
SCENARIO A: staging_mode = "slot"                 SCENARIO B: staging_mode = "app"
(plan SKU must be Standard S1+)                   (works on cheap Basic B1)

┌──────────────────────────────────────────┐      ┌──────────────────────────────────────────┐
│ rg-ghr-platform (canadacentral)          │      │ rg-ghr-platform (canadacentral)          │
│                                          │      │                                          │
│  ┌────────────────────────────────────┐  │      │  ┌────────────────────────────────────┐  │
│  │ Shared App Service Plan (S1)       │  │      │  │ Shared App Service Plan (B1)       │  │
│  │                                    │  │      │  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │      │  │  ┌──────────────┐ ┌──────────────┐ │  │
│  │  │ Web App: <app>               │  │  │      │  │  │ <app>        │ │ <app>-staging│ │  │
│  │  │  ├─ production slot (main)   │  │  │      │  │  │ (production) │ │ (staging)    │ │  │
│  │  │  └─ slot "staging"           │  │  │      │  │  └──────────────┘ └──────────────┘ │  │
│  │  └──────────────────────────────┘  │  │      │  │  ┌──────────────┐ ┌──────────────┐ │  │
│  │  ┌──────────────────────────────┐  │  │      │  │  │ <app2>       │ │ <app2>-stg   │ │  │
│  │  │ Web App: <app2> + slot ...   │  │  │      │  │  └──────────────┘ └──────────────┘ │  │
│  │  └──────────────────────────────┘  │  │      │  │  ... 2 web apps per app            │  │
│  └────────────────────────────────────┘  │      │  └────────────────────────────────────┘  │
│                                          │      │                                          │
│  per app: kv-<app>-<hash> (Key Vault)    │      │  per app: kv-<app>-<hash> (Key Vault)    │
│           appi-<app> (App Insights)      │      │           appi-<app> (App Insights)      │
└──────────────────────────────────────────┘      └──────────────────────────────────────────┘

Deploy targets (GitHub Actions):                Deploy targets (GitHub Actions):
  staging    → app-name: <app>, slot: staging     staging    → app-name: <app>-staging, slot: ''
  production → app-name: <app>, slot: ''          production → app-name: <app>, slot: ''
```

### Cost comparison

| | Scenario A — `slot` | Scenario B — `app` |
|---|---|---|
| Plan | 1× **S1** ≈ **$73/mo**, shared by ALL apps | 1× **B1** ≈ **$13/mo**, shared by ALL apps |
| Web apps per app | 1 (slot is free) | 2 (`<app>` + `<app>-staging`) |
| Marginal cost per app | $0 | $0 (until plan capacity) |
| Slot swap (zero-downtime promote) | Yes | **No** — promotion = redeploy to prod |
| Staging warm-up / always-on | Yes | Yes |
| Slots at all | Yes | **None** (B1 has no slots) |
| Break-even | A wins from ~app #1 if you need slots/swaps | B cheaper until ~5–6 apps' worth of S1 capacity pressure |

Scenario B's hard limits: no deployment slots, no staging swap, no slot-based
zero-downtime promotion. Recommendation: **Scenario A** (see §8).

---

## 2. One-time setup

### 2.1 Terraform state storage (do this FIRST — before any `terraform init`)

**Why this exists:** Terraform keeps a "memory" of everything it created — the
state file. Without it, Terraform forgets what it manages and cannot safely
update or destroy anything. That file lives in one Azure Storage account that
**you create once, by hand, before anything else works.**

**Why its own resource group (`rg-ghr-tfstate`) instead of an existing one:**
the state storage must **outlive every app**. `deploy.sh destroy` and app-RG
cleanups come and go; if the state storage is deleted, Terraform forgets every
app at once and you lose clean update/destroy for the whole platform. A
dedicated RG makes it visibly untouchable. One storage account (~$0.50/month)
holds the state for **every app, forever** — nothing here repeats per app.

**If you skip this step**, `terraform init` fails with:
`Error: retrieving Storage Account ... 404 ResourceGroupNotFound` — that error
means "come do §2.1", nothing is broken.

```bash
az login
az account set --subscription "<subscription>"

# One-time, ever. Use the SAME region as your platform (canadaeast for GHR).
az group create --name rg-ghr-tfstate --location canadaeast
az storage account create --name stghrtfstate --resource-group rg-ghr-tfstate \
  --location canadaeast --sku Standard_LRS --min-tls-version TLS1_2 \
  --allow-blob-public-access false
az storage container create --name tfstate --account-name stghrtfstate --auth-mode login
# Recommended: blob versioning for state recovery
az storage account blob-service-properties update --account-name stghrtfstate \
  --enable-versioning true
```

(The storage account name must be globally unique across Azure. If
`stghrtfstate` is ever taken, pick another and update `backend.hcl` to match.)

State locking is automatic: the azurerm backend acquires a **blob lease** on
the state file for every state-writing operation — no lock table to create
(true for azurerm provider/backend ~> 4.x).

### 2.2 OIDC app registration (GitHub Actions → Azure, no stored secrets)

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
az ad app create --display-name ghr-github-deploy
APP_ID=$(az ad app list --display-name ghr-github-deploy --query "[0].appId" -o tsv)
az ad sp create --id "$APP_ID"
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

# Least privilege: NO resource-group or subscription-level role for the SP.
# Each per-app deployment (infra/app) grants the SP "Website Contributor"
# on THAT app's site only. An RG/subscription-level role (e.g. Contributor)
# would let any poisoned app-repo workflow seize every app on the platform —
# and, via Key Vault MANAGEMENT-plane writes (flipping the vault back to
# access-policy mode), read every app's secrets. Do not do it.
# Optional: read-only visibility for debugging.
az role assignment create --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Reader --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-ghr-platform"

# Federated credential. CAUTION: GitHub issues IMMUTABLE `sub` claims (numeric
# owner/repo IDs) for repos created after 2026-07-15 — a name-based wildcard
# `repo:ORG/*` may NOT match new repos. Verify the subject format first:
#   gh api /repos/<org>/<repo>/actions/oidc/customization/sub
# Prefer a per-repo credential with the exact subject over an org-wide wildcard.
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "ghr-org-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<ORG>/<REPO>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Also create the operator's own identity note: the human operator (Ali) deploys
from his `az login` session; his AAD object ID goes to `OPERATOR_OBJECT_ID`.

> **Blast radius (read this before onboarding apps):** v1 uses ONE shared deploy
> SP for all apps, so it accumulates `Website Contributor` on every app. Any
> workflow in ANY app repo can therefore deploy code to ANY app on the platform
> (and code running in an app can read that app's own resolved Key Vault
> references at runtime). v1 mitigations: protect `main` in every app repo,
> restrict who can create repos and edit workflows, and use per-repo federated
> credentials (exact subject) rather than an org-wide wildcard. v2 options:
> per-app service principals, or GitHub Environments with required reviewers
> gating the deploy job.

### 2.3 GitHub org secrets

Set these as ORGANIZATION secrets (visible to app repos):
`AZURE_CLIENT_ID` (appId), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.

### 2.4 Apply the platform root

```bash
cp infra/platform/backend.hcl.example infra/platform/backend.hcl   # fill in values
cp infra/platform/terraform.tfvars.example infra/platform/terraform.tfvars  # pick sku + staging_mode

terraform -chdir=infra/platform init -backend-config=backend.hcl
terraform -chdir=infra/platform apply
terraform -chdir=infra/platform output   # note plan id, rg name, location
```

The platform root REJECTS `staging_mode = "slot"` with F1/D1/B1/B2/B3 SKUs —
slots need Standard or better. (`staging_mode = "app"` has no SKU restriction.)

Keep the same `backend.hcl` values handy for the app root (deploy.sh passes the
per-app state key itself):
```bash
cp infra/platform/backend.hcl infra/app/backend.hcl
export BACKEND_CONFIG_ARGS="-backend-config=backend.hcl"
```

---

## 3. Per-app workflow (both scenarios)

```bash
# 0. FIRST, IN THE APP REPO (one time, committed to git): the repo carries its
#    own deployment contract + CI. This is the design, not an optional extra —
#    deploy.sh reads azure-deploy.json from the repo ROOT by default.
cd <app-repo>
cp <infra>/templates/app-repo/azure-deploy.json ./azure-deploy.json   # edit: runtime, startup, kv_secrets, db_migration_command
cp <infra>/templates/app-repo/CLAUDE.md ./CLAUDE.md
mkdir -p .github/workflows && cp <infra>/templates/app-repo/.github/workflows/deploy.yml ./.github/workflows/
#    (edit deploy.yml env: AZURE_WEBAPP_NAME / STAGING_MODE / RUNTIME / DB_MIGRATION_COMMAND)
git checkout -b chore/deployment-setup && git add -A && git commit -m "chore: deployment contract + CI" && git push -u origin HEAD
#    merge the PR, then: git checkout -b staging && git push -u origin staging

# 1. Preflight (standalone, optional — deploy.sh runs it anyway)
python3 infra/scripts/preflight.py --repo https://github.com/<org>/<repo> --check-names

# 2. Deploy (preflight -> plan -> HUMAN GATE -> apply -> smoke test -> URL)
#    Note: NO --contract flag in the normal flow — the contract comes from the repo.
export OPERATOR_OBJECT_ID="<ali-aad-object-id>"        # Key Vault Secrets Officer
export DEPLOY_SP_OBJECT_ID="<github-actions-sp-object-id>"  # Website Contributor
export STAGING_MODE=slot                                # or app — MUST match the platform tfvars
infra/scripts/deploy.sh deploy https://github.com/<org>/<repo> --app-name <name>

# deploy.sh stops and asks you to TYPE THE APP NAME before applying. No auto-approve.
# Afterwards it curls the health endpoint (6 attempts, 30s apart) and prints URLs.
# (--contract <path> exists ONLY as a testing shortcut when the repo has no contract yet.)
```

- Slot mode: staging URL is `https://<app>-staging.azurewebsites.net` (the slot).
- App mode: staging URL is `https://<app>-staging.azurewebsites.net` (a second
  web app). Same URL shape, different resource — the workflow template handles
  the difference via `STAGING_MODE`.
- Give the app owner the URLs + vault name; they set `AZURE_WEBAPP_NAME`,
  `STAGING_MODE`, `RUNTIME` in their `.github/workflows/deploy.yml`.
- Destroy: see §5.

---

## 3.1 Branch → environment model (all apps, current and future)

Every app repo has two long-lived branches, and **merging is the deploy button**:

| Branch | Merging into it... | Database migrated |
|---|---|---|
| `staging` | deploys the STAGING app/slot | STAGING database |
| `main` | deploys the PRODUCTION app | PRODUCTION database |

Daily flow for every change:

```
feature/<name>  --PR-->  staging  --verify on staging URL--PR-->  main
```

- **Database migrations run automatically in CI** (the `db_migration_command`
  contract field / `DB_MIGRATION_COMMAND` workflow env), AFTER deps install and
  BEFORE the new code goes live. The old code keeps serving while migrations
  apply, so migrations MUST be backward-compatible (expand/contract) and
  forward-only — never edit an applied migration.
- **CI needs the DB connection strings as repo secrets** (Key Vault references
  only resolve inside the running app; the migration runner needs raw values).
  Operator creates them once per app:
  ```bash
  gh secret set DATABASE_URL_STAGING    --repo <org>/<repo> --body "mysql://.../app_staging"
  gh secret set DATABASE_URL_PRODUCTION --repo <org>/<repo> --body "mysql://.../app_production"
  ```
  (For DB-less apps neither the secrets nor `db_migration_command` are set and
  the migration step skips itself.)
- **Firewall note:** GitHub-hosted runners must be able to reach the database
  server. For Azure MySQL/Postgres, either enable "Allow public access from any
  Azure service" or add runner IP ranges; otherwise the migration step fails
  with a connection error.
- **deploy.sh `--branch <name>`** only selects which branch is cloned for
  validation/provisioning. Day-to-day branch deploys never touch deploy.sh —
  they run entirely in the app's GitHub Actions.
- Example (Touchpoint): `db_migration_command = "npm run db:push"` (drizzle-kit
  generate + migrate), MySQL databases `touchpoint_staging` / `touchpoint` —
  merge a PR to `staging` → staging app + `touchpoint_staging` updated; merge
  `staging` to `main` → prod app + `touchpoint` updated.

---

## 4. Secrets runbook

Two supported ways to give an app its secrets. **Pick per environment:**

### Option A — plain environment variables (staging/dev)

Put the value straight into the contract's `app_settings`:

```json
"app_settings": { "DATABASE_URL": "mysql://user:pass@server/app_staging" }
```

- Simplest: nothing else to do. No vault is even created (the module skips it
  when `kv_secrets` is empty).
- **The trade-off:** the value is visible in the Azure portal app settings and
  in Terraform state to anyone with access. Fine for staging/dev databases and
  throwaway credentials — **not acceptable for production.**
- Preflight allows it for database apps but prints the plaintext warning.

### Option B — Azure Key Vault (production, the default)

Terraform creates the vault and the RBAC (only when `kv_secrets` is declared);
**secrets are never created by Terraform.** Humans set them, once per app:

```bash
KV=$(terraform -chdir=infra/app output -raw key_vault_name)   # per-app vault, e.g. kv-myapp-a1b2
az keyvault secret set --vault-name "$KV" --name database-url --value "postgres://..."
```

The app declares the mapping in `azure-deploy.json`:
```json
"kv_secrets": { "DATABASE_URL": "database-url" }
```
Terraform then injects `DATABASE_URL=@Microsoft.KeyVault(SecretUri=https://<own-vault>/secrets/database-url)`
into app settings. Each app's managed identity can read ONLY its own vault.

**Caveats that bite people (vault mode):**
- **KV references are cached.** After rotating a secret, RESTART the app (or
  touch an app setting) or it keeps the old value:
  `az webapp restart --name <app> --resource-group rg-ghr-platform`
- KV references are NOT validated at deploy time. A typo'd secret name means the
  app receives the literal reference string. The smoke test is the backstop.
- Slot mode: if a secret value must differ per slot (e.g. staging DB vs prod DB),
  the setting name goes in `slot_sticky_setting_names` so it doesn't swap.

**Either way, CI migrations** still need `DATABASE_URL_STAGING` /
`DATABASE_URL_PRODUCTION` as GitHub repo secrets (§3.1) — the migration runner
can't use Key Vault references.

---

## 4.5 Databases — the manual process (always)

**Automation never creates, migrates unsupervised, or destroys databases.** A
web app is disposable; a database is not. Every app gets its databases by hand,
one per environment, and CI only *runs migrations* against them.

**One-time per environment (example: Touchpoint staging on Azure MySQL Flexible Server):**

```bash
# 1. Create the database ON the existing server (no new server needed)
az mysql flexible-server db create \
  --resource-group <rg-of-the-server> \
  --server-name touchpoint-server \
  --database-name touchpoint_staging

# 2. Apply the schema from the app repo (drizzle example)
cd <app-repo>
DATABASE_URL="mysql://<user>:<password>@touchpoint-server.mysql.database.azure.com/touchpoint_staging" npm run db:push
```

Facts to know:
- **FQDN pattern:** `<server>.mysql.database.azure.com` (Flexible Server).
- **Firewall:** your client IP must be allowed on the server for step 2, and
  GitHub-hosted runners need access for CI migrations ("Allow public access
  from any Azure service" or runner IP allowlist).
- **Naming:** `<app>_staging` / `<app>` (or `<app>_prod`) — one database per
  environment, never shared. Staging pointing at the prod DB is the one
  unforgivable mistake in this system.
- **After creation:** the connection string goes to the app via the contract
  (env-var mode: `app_settings`; vault mode: `az keyvault secret set`, §4) and
  to CI via repo secrets (§3.1). The string itself never enters Terraform or
  git.
- **Schema changes after that:** automatic — `db_migration_command` runs in CI
  on every merge (expand/contract, forward-only).

---

## 5. Rollback / destroy

```bash
infra/scripts/deploy.sh destroy <app-name>
```

- Requires typing the app name. Refuses to run anywhere near the platform root —
  shared infrastructure is NEVER destroyed by automation.
- Destroys only the per-app state (`apps/<name>.tfstate`): web app, slot or
  staging app, Key Vault, App Insights, role assignments.
- **Soft delete:** the vault is soft-deleted; its NAME stays reserved for the
  90-day retention window. Recover with `az keyvault recover --name <vault>` or
  free the name with `az keyvault purge --name <vault>` (irreversible).
- Rollback of a bad CODE deploy = redeploy the previous artifact (slot mode:
  `az webapp deployment slot swap` if the previous build is still on staging).

---

## 6. Failure triage loop

1. Smoke test fails → deploy.sh exits 2 and prints the exact log command, e.g.
   `az webapp log tail --name <app> --resource-group rg-ghr-platform [--slot staging]`.
2. Deeper telemetry: App Insights (`appi-<app>`) in the portal — requests,
   exceptions, traces (created per app by the module).
3. Human fixes the app/config.
4. **Standing rule: every NEW failure pattern must be converted into a preflight
   check** (new marker file, new dependency signature, new contract validation).
   This loop — not preflight's starting coverage — is what moves accuracy up.
   Preflight catches *structural* issues; runtime-only risks (native deps,
   private packages, port binding) are caught by the smoke test + this loop.

---

## 7. Accuracy — honest numbers (spec §6)

| Scenario | v1 first-attempt success | Phase 2/3 target |
|---|---|---|
| In-contract simple app | **60–80%** | 85–95% (after Touchpoint + 2–3 real apps feed the failure loop) |
| In-contract but needs a nudge (startup cmd, missing env var) | 15–30% of apps | 5–15% |
| Structurally out-of-contract (monorepo, DB provisioning, workers) | Refused by preflight | Refused by preflight |

Terraform can partially apply and Azure can report success on a misconfigured
app; the design fails fast and surfaces errors but does not guarantee zero
silent failures. Smoke test = HTTP liveness only.

---

## 8. Decision guide: which scenario should GHR pick?

**Recommendation: Scenario A (`staging_mode = "slot"`, S1 plan, ~$73/mo).**
Slots give true zero-downtime promotion (`swap`), keep staging configuration
identical to production by construction, and cost nothing per app. The spec
already budgets S1 as approved. The B1+slots bug from the old blueprint is
impossible here — the platform root validation rejects slot-incapable SKUs.

**If Ben picks B anyway** (cost-first, ~$13/mo): change ONE value in
`infra/platform/terraform.tfvars`:

```hcl
app_service_sku = "B1"
staging_mode    = "app"
```

Re-apply the platform root, set `STAGING_MODE=app` when running deploy.sh, and
set `STAGING_MODE: "app"` in each app repo's deploy.yml. What changes in
behavior: each app becomes TWO web apps on the plan, staging is deployed to
`<app>-staging`, and there is no swap — promoting means deploying the same
artifact to the production app. B1 limits (no slots, no swap, shared CPU) apply.

---

## 9. Gotchas — read this BEFORE running the script

Everything on this page has bitten someone at least once.

**Machine prerequisites (one-time, ~5 min):**
- `terraform` (≥1.5), `python3` + `pip3 install --user jsonschema` (**hard
  requirement for deploys** — standalone preflight can skip it, deploy.sh cannot),
  `az` CLI logged in (`az login`), `jq` (optional nicety).
- **`git` is enough.** `gh` (GitHub CLI) is optional — the script tries
  `gh repo clone` first only because gh handles PRIVATE repo auth automatically,
  then falls back to plain `git clone`. With just git: public repos always work;
  private repos work if you have an SSH key or credential helper configured.
  You never need to install gh for the script itself.

**When running `deploy.sh deploy`:**
1. **First deploy = empty house.** The script builds Azure infrastructure; the
   app CODE arrives separately via the repo's GitHub Actions (on push/merge).
   So on the very first run the smoke test may fail with a 404 — that usually
   just means no code has been deployed yet. Merge to `staging`/`main`, wait
   2-3 minutes, check the URL again. Not a bug.
2. **Smoke test failure = exit code 2, and the infrastructure is FINE.** The
   script prints the exact `az webapp log tail` command — go read the logs.
   Don't re-run the deploy hoping it changes; the problem is in the app or its
   settings (missing secret, wrong startup command), not in Terraform.
3. **The typed gate is intentional.** You must type the app name before anything
   is applied. `--yes` skips it — fine when re-running something you already
   reviewed, NEVER hand it to automation.
4. **Refusals are the product, not a failure.** Monorepo, Dockerfile, background
   worker, or database-without-declared-secret → the script refuses and says
   "route to a human". That app needs a custom deployment, not a retry.
5. **Staging-mode mismatch stops early.** If the platform was applied with
   `staging_mode=slot` and you run with `--staging-mode app` (or vice versa),
   the script refuses. Match the flag, or re-apply the platform root.
6. **Secrets are ALWAYS manual.** Azure side: `az keyvault secret set` once per
   app (the script prints the vault name). GitHub side: repo/org secrets by
   hand. After rotating a secret, RESTART the app — Key Vault references are
   cached.
7. **App names are globally unique across all of Azure.** If the name is taken,
   preflight's `--check-names` catches it (needs `az`); otherwise the apply
   fails late with a naming error — pick a new name, don't force it.

**When running `deploy.sh destroy`:**
8. Typed confirmation required; it physically cannot touch the shared platform
   (guard built in). The app's Key Vault is **soft-deleted: its name stays
   reserved for 90 days**. Re-deploying the same app soon? `az keyvault recover`
   (restore) or `az keyvault purge` (permanent — irreversible).

**General:**
9. **Every app is isolated** — own Terraform state (`apps/<name>.tfstate`), own
   Key Vault. One app breaking never affects another. Re-running deploy.sh on
   the same app is safe (Terraform is idempotent; it plans a diff).
10. **Run it from anywhere** — paths resolve relative to the script location.
    You need network access to Azure (and GitHub if cloning, not using a local
    path).
11. **Create ONLY what was requested (hard rule).** deploy.sh creates a
    prod+staging pair BY DEFAULT because that's the normal new-app case. If the
    app already has a production elsewhere and you were asked for STAGING ONLY,
    you must pass `--no-prod` (requires `--staging-mode app`):
    `deploy.sh deploy <repo> --app-name <app> --env staging --staging-mode app --no-prod`.
    Never leave an unrequested resource running "because the script made it" —
    that mistake happened once (an idle prod app), was destroyed the same day,
    and is why this flag exists.

---

## Appendix — deploy.sh reference

```
deploy.sh deploy <git-url-or-local-path> [--app-name NAME] [--env staging|prod]
                 [--staging-mode slot|app] [--contract PATH] [--branch NAME]
                 [--no-prod] [--yes]
deploy.sh destroy <app-name>
```

`--no-prod`: staging-only deployment (no production app/slot/AI is created or
kept). Requires `--staging-mode app`. Re-running an existing deployment with it
DESTROYS the production app (plan shows the destroys; the typed gate still
applies).

Environment: `STAGING_MODE`, `BACKEND_CONFIG_ARGS`, `OPERATOR_OBJECT_ID`,
`DEPLOY_SP_OBJECT_ID`, `SLACK_WEBHOOK_URL` (posts the final URL),
`PLATFORM_RESOURCE_GROUP_NAME` / `PLATFORM_APP_SERVICE_PLAN_ID` /
`PLATFORM_LOCATION` (fallbacks when platform outputs aren't readable).
Exit codes: 0 ok, 1 failure, 2 smoke test failed after apply.
