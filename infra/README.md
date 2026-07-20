# GHR Deployment Automation — Runbook

Terraform + GitHub Actions system that takes a GitHub repo URL and produces a
working Azure URL, with humans only where judgment is needed. This document is
the operator runbook ("the workings").

Plan of record: `docs/superpowers/specs/2026-07-17-ghr-deployment-automation.md`
(v2, post-review). All Critical/Major review findings are addressed in code here.

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

### 2.1 Terraform state storage

State lives in Azure Storage. The azurerm backend acquires a **blob lease** on
the state file for every state-writing operation, so locking is automatic —
no lock table to create (true for azurerm provider/backend ~> 4.x).

```bash
az login
az account set --subscription "<subscription>"

az group create --name rg-ghr-tfstate --location canadacentral
az storage account create --name stghrtfstate --resource-group rg-ghr-tfstate \
  --location canadacentral --sku Standard_LRS --min-tls-version TLS1_2
az storage container create --name tfstate --account-name stghrtfstate
# Recommended: blob versioning for state recovery
az storage account blob-service-properties update --account-name stghrtfstate \
  --enable-versioning true
```

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
# 0. App repo contains azure-deploy.json (+ template files from infra/templates/app-repo/)

# 1. Preflight (standalone, optional — deploy.sh runs it anyway)
python3 infra/scripts/preflight.py --repo https://github.com/<org>/<repo> --check-names

# 2. Deploy (preflight -> plan -> HUMAN GATE -> apply -> smoke test -> URL)
export OPERATOR_OBJECT_ID="<ali-aad-object-id>"        # Key Vault Secrets Officer
export DEPLOY_SP_OBJECT_ID="<github-actions-sp-object-id>"  # Website Contributor
export STAGING_MODE=slot                                # or app — MUST match the platform tfvars
infra/scripts/deploy.sh deploy https://github.com/<org>/<repo> --app-name <name>

# deploy.sh stops and asks you to TYPE THE APP NAME before applying. No auto-approve.
# Afterwards it curls the health endpoint (6 attempts, 30s apart) and prints URLs.
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

Terraform creates the vault and the RBAC; **secrets are never created by
Terraform.** Humans set them, once per app:

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

**Caveats that bite people:**
- **KV references are cached.** After rotating a secret, RESTART the app (or
  touch an app setting) or it keeps the old value:
  `az webapp restart --name <app> --resource-group rg-ghr-platform`
- KV references are NOT validated at deploy time. A typo'd secret name means the
  app receives the literal reference string. The smoke test is the backstop.
- Slot mode: if a secret value must differ per slot (e.g. staging DB vs prod DB),
  the setting name goes in `slot_sticky_setting_names` so it doesn't swap.

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

## Appendix — deploy.sh reference

```
deploy.sh deploy <git-url-or-local-path> [--app-name NAME] [--env staging|prod]
                 [--staging-mode slot|app] [--contract PATH] [--yes]
deploy.sh destroy <app-name>
```

Environment: `STAGING_MODE`, `BACKEND_CONFIG_ARGS`, `OPERATOR_OBJECT_ID`,
`DEPLOY_SP_OBJECT_ID`, `SLACK_WEBHOOK_URL` (posts the final URL),
`PLATFORM_RESOURCE_GROUP_NAME` / `PLATFORM_APP_SERVICE_PLAN_ID` /
`PLATFORM_LOCATION` (fallbacks when platform outputs aren't readable).
Exit codes: 0 ok, 1 failure, 2 smoke test failed after apply.
