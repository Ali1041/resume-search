# New Organization Onboarding — The Generic Playbook

**What this is:** how to take the automation from "works for one org" to "works
for any client" — the franchise playbook. Everything in `infra/` is org-neutral;
the org-specific surface is exactly **one variable** (`project_name`), **one
backend config**, and **a short manual checklist** per org.

**The rule that keeps this clean:** the engine (modules, scripts, templates,
schema) is shared and never edited per org. Orgs differ only in configuration.

**The process, end to end:** Part 0 Foundations (this page) → Part 1 Platform
(per org) → Part 2 Per-app loop → Part 3 Daily flow (merge to deploy).

---

# Part 0 — Foundations: before ANY infra step (~30–60 min, mostly waiting on people)

Do not touch Terraform until every box here is checked. Skipping foundations is
how deployments turn into archaeology.

## 0.1 Accounts that must exist

| Account | Who creates/owns it | Notes |
|---|---|---|
| **GitHub organization** | Client (or us on their behalf) | Operator needs **Owner** role. All app repos live here. Example: `Recovery-With-Heart` |
| **Azure subscription** | Client's billing account, or ours for managed hosting | Where every app runs. One subscription can host many orgs (namespaced by `project_name`) |
| **MySQL/Postgres server** (only if apps have DBs) | Client or us | Existing server reused across apps; one DATABASE per app per environment |
| **Slack channel** (optional) | Either | Deploy notifications via `SLACK_WEBHOOK_URL` |

> **AWS note:** this automation is Azure-only (App Service, Key Vault, Entra
> OIDC). AWS would be a separate platform effort — not a config change.

## 0.2 Access the operator must hold (verify BEFORE starting)

| Access | Level | Verify with |
|---|---|---|
| Azure subscription | **Contributor** (create RGs, plans, web apps, vaults, role assignments) | `az account show` → correct subscription |
| Microsoft Entra ID | **Application Administrator** (or Cloud App Admin) — needed to create the OIDC app registration | `az ad app create --display-name probe-xxx --query appId -o tsv` then delete it, or just try step 2 and watch for 403 |
| GitHub org | **Owner** (org secrets, repo creation, branch rules) | create a test repo, delete it |
| DB server | **Admin login** (create databases, firewall rules) | `az mysql flexible-server db list -g <rg> -n <server>` |
| Operator's own AAD object id | — | `az ad signed-in-user show --query id -o tsv` → goes to `OPERATOR_OBJECT_ID` |

## 0.3 Access the CLIENT needs (and does NOT need)

| Who | Gets | Does NOT get |
|---|---|---|
| Client devs (e.g. Josh) | GitHub repo write, PR workflow, the app-repo `CLAUDE.md` rules | Azure portal access, Terraform, state storage, Key Vault data-plane |
| Client approver (e.g. Ben) | The scenario A/B cost decision, URLs | anything else |
| CI (GitHub Actions) | OIDC federated token → **Website Contributor per app only** | stored secrets, RG-level roles, KV data-plane |

## 0.4 Decisions to record BEFORE starting (write them in the org's section of your notes)

1. `project_name` (2–12 chars, becomes `rg-<name>-platform` everywhere)
2. **Region** — usually a data-residency answer (GHR → canadaeast)
3. **Scenario A or B** (slots on S1 ~$73/mo vs separate staging apps on B1 ~$13/mo) — billing decision, needs the approver
4. **Secrets posture per environment** — env-var mode (staging OK) vs vault mode (prod required)
5. Slack notifications on/off

## 0.5 The intake checklist (copy into the org's ticket/doc)

```
Org:                       GitHub org name:              Azure sub ID:
Tenant ID:                 project_name:                 Region:
Scenario (A/B):            SKU:                          Operator (name + AAD object id):
DB server (if any):        DB admin who:                 Slack webhook (opt):
Approver (billing):        Date OIDC app reg created:    SP object id:
```

---

## What you need from the organization (before touching anything)

| Item | Why | Example |
|---|---|---|
| Their GitHub organization name | Repos, org secrets, OIDC trust live there | `Recovery-With-Heart` |
| An Azure subscription (theirs or yours) | Where apps run | GHR subscription |
| Operator identity (who runs deploys) | `OPERATOR_OBJECT_ID`, KV Secrets Officer | Ali's AAD object id |
| Region + scenario decision | `location`, `staging_mode` + SKU | canadaeast, Case B (app mode, B1) |
| DB admin access (if apps have databases) | Staging/prod DB creation is manual, always | MySQL server admin |

## The one knob per org: `project_name`

`infra/platform/terraform.tfvars` for each org:

```hcl
project_name    = "acme"          # 2-12 chars → rg-acme-platform, asp-acme-shared
location        = "canadaeast"    # org's region
app_service_sku = "B1"            # B1 = Case B (cheap); S1+ = Case A (slots)
staging_mode    = "app"           # must match the SKU choice
```

Everything an org owns is namespaced by that prefix, so many orgs can share one
Azure subscription without collisions. (For stronger isolation, give each org
its own subscription or at least its own tfstate storage account.)

---

## The per-org checklist

### 1. State storage (once per org — or reuse one account with a per-org container)

```bash
az group create -n rg-acme-tfstate -l canadaeast
az storage account create -n stacmetfstate -g rg-acme-tfstate --sku Standard_LRS
az storage container create -n tfstate --account-name stacmetfstate
# → fill infra/platform/backend.hcl + infra/app/backend.hcl with these values
#   (app/backend.hcl = same values MINUS the "key" line)
```

### 2. OIDC + GitHub org secrets (manual, once per org — needed only for CI)

Two DIFFERENT kinds of Azure access are easy to confuse:

| Access | Who uses it | How it exists |
|---|---|---|
| **Operator access** — your user account on the subscription | You, running Terraform/`az` from your Mac | Usually already true (you can see the sub in the portal) |
| **CI access** — an Entra app registration (service principal) + federated credential | GitHub Actions, deploying on merge | **Must be created per org** — this is the OIDC setup |

Seeing the org/repos in the Azure portal (e.g. via an old Deployment Center
OAuth link) is NEITHER of these being "done" for CI. Verify with:
`az ad app list --display-name <org>-github-deploy` — empty result = not done.

- Create the deploy app registration + federated credential trusting
  `repo:<their-org>/<repo>:ref:refs/heads/main` (README §2.2 — verify the
  repo's `sub` claim format first; prefer per-repo credentials over wildcards).
  **One app registration can serve many orgs** — just add one federated
  credential per org/repo to the same registration.
- Set the org secrets `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` /
  `AZURE_SUBSCRIPTION_ID`. Every repo in their org inherits them.
- Give the SP **no RG-level role**. Each app deployment grants it Website
  Contributor on that app's site only (`DEPLOY_SP_OBJECT_ID`).

### 3. Platform apply (once per org)

```bash
terraform -chdir=infra/platform init -backend-config=backend.hcl -reconfigure
terraform -chdir=infra/platform apply
```

### 4. Per-app loop (the part that repeats forever)

For **each new app** in the org — this is the only per-app work:

1. **Repo:** copy `infra/templates/app-repo/` files in (`azure-deploy.json`,
   `CLAUDE.md`, `.github/workflows/deploy.yml`), fill values, commit on a
   branch, merge; create the `staging` branch.
2. **Data (if any):** create the app's staging/prod databases by hand; the
   contract's `kv_secrets` + `db_migration_command` point at them.
3. **Provision:**
   ```bash
   export OPERATOR_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)
   export DEPLOY_SP_OBJECT_ID=<org-deploy-sp-object-id>
   export BACKEND_CONFIG_ARGS="-backend-config=backend.hcl"
   infra/scripts/deploy.sh deploy https://github.com/<org>/<repo> \
     --app-name <org>-<app> --env staging --staging-mode app
   ```
   **Create ONLY what was requested.** The default is a prod+staging pair. If
   the ask is "staging for an app whose prod already exists", add `--no-prod`
   (requires `--staging-mode app`). Never leave an unrequested resource
   running because the script defaults made it.
   Naming convention: prefix app names with the org (`acme-timesheet`) — app
   names are globally unique across Azure.
4. **Secrets (manual):** `az keyvault secret set` for the app's vault; repo
   secrets `DATABASE_URL_STAGING` / `DATABASE_URL_PRODUCTION` if it has a DB.
5. **Hand over the URLs.** Daily flow from then on: merge to `staging` →
   staging updates; merge to `main` → prod updates. Zero operator involvement.

### 5. Selling it as a service (the pitch built into the design)

- Your cost per org: one platform apply (~15 min) + ~10 min per app + secrets.
- Their ongoing ask of you: ~zero — failures go to the triage loop (README §6).
- The productized story: "your developers merge PRs; environments, deploys,
  migrations, and secrets isolation are already handled."
- Case A vs Case B is a per-org billing conversation: Case B (~$13/mo) for
  price-sensitive, Case A (~$73/mo, slots + swap) for "real" production setups.

---

## What is intentionally NOT org-neutral (and why)

| Thing | Status | Why |
|---|---|---|
| `project_name`, region, SKU, staging_mode | Per-org config (tfvars) | Orgs legitimately differ |
| tfstate backend values | Per-org config (backend.hcl, gitignored) | State is org-private |
| GitHub org secrets, OIDC, repo secrets | Manual per org | The boundary: automation = Azure only |
| Engine (modules/scripts/templates/schema) | **Shared, edit once for all orgs** | A fix improves every org at once |

If you ever find yourself editing `infra/` code "just for one org" — stop; that
belongs in tfvars, the contract, or the org's own repo.
