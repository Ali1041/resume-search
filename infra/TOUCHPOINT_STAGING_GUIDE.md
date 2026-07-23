# Touchpoint Staging Environment — Operator Runbook (Case B)

**Goal:** `https://touchpoint-rwh-staging.azurewebsites.net` serving the `staging`
branch, wired to a `touchpoint_staging` MySQL database, auto-deploying on every
merge to `staging`. Case B = separate staging web app on the cheap B1 plan (no slots).

**The access model (why this is nearly hands-off):** every step below needs the
*minimum* access that can do the job, each step needs it *once*, and after setup
the only ongoing action is "merge a PR". Nothing stores a long-lived credential
anywhere: your local `az login` drives Terraform, GitHub Actions will use OIDC
(short-lived tokens, no secrets), and secrets live only in Azure Key Vault +
GitHub repo secrets (entered by hand, never by scripts).

---

## Access & why — the complete table

| # | Step | Access required | Why this much and no more | How often |
|---|---|---|---|---|
| 0 | Operator machine tools: `terraform`, `az` CLI, `python3`+`jsonschema`, `git` | Local install | The script's only dependencies (`gh` NOT required — plain git is enough) | Once |
| 1 | `infra/platform` apply | Your `az login` with Contributor on the subscription | Creates the shared resource group + App Service Plan. Nothing less can create resources; nothing more is needed | Once |
| 2 | Terraform state storage (`rg-ghr-tfstate` + `stghrtfstate`) | Same `az login` | Holds state files. Backend uses `use_oidc` — no storage keys anywhere | Once (done) |
| 3 | Staging database (`touchpoint_staging`) + migrations | MySQL admin | **Automation never creates databases** (data is the risky thing). One manual command, then `DATABASE_URL=... npm run db:push` | Once per environment |
| 4 | App repo files (`azure-deploy.json`, `deploy.yml`, `staging` branch) | GitHub push to the repo | The repo carries its own contract + CI so app and config never drift | Once per app (done for Touchpoint) |
| 5 | `deploy.sh deploy` | Same `az login` + `OPERATOR_OBJECT_ID` (your AAD object id: `az ad signed-in-user show --query id -o tsv`) | Creates the two web apps, per-app Key Vault, RBAC, App Insights. Your object id gets **Key Vault Secrets Officer on this app's vault only** — that's the access that lets you do step 6 | Once per app |
| 6 | `az keyvault secret set` (the real MySQL URL) | The Secrets Officer role from step 5 | Terraform wires the *reference*; a human enters the *value*. Secrets never touch git or Terraform state | Once per secret |
| 7 | GitHub repo secrets `DATABASE_URL_STAGING` / `DATABASE_URL_PRODUCTION` | Repo admin | CI's migration runner needs the raw connection string (Key Vault references only resolve inside the running app). **Manual by design: automation touches Azure only** | Once per app |
| 8 | OIDC app registration + federated credential (README §2.2) | Entra ID Application Administrator | Lets GitHub Actions mint short-lived Azure tokens with **zero stored client secrets**. Without it, CI cannot deploy. Give it NO RG-level role — the per-app deployment grants Website Contributor per site (step 5's `DEPLOY_SP_OBJECT_ID`) | Once for the whole platform |
| 9 | GitHub org secrets `AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID` | Org owner | Every app repo inherits them; no per-repo secret setup ever | Once for the whole platform |

After this table is done once, **ongoing access needed: none.** Daily work is
merge-to-`staging` → auto-deploy, merge-to-`main` → auto-deploy.

---

## Current state (as of 2026-07-20)

- [x] Step 1–2: platform applied — `rg-ghr-platform` + `asp-ghr-shared` (B1, canadaeast, `staging_mode=app`)
- [x] Step 3: `touchpoint_staging` DB — **Ali to confirm done**
- [x] Step 4: `staging` branch created on GitHub; `chore/deployment-setup` pushed
  (PR: https://github.com/Recovery-With-Heart/touchpoint/compare/staging...chore/deployment-setup)
- [x] Preflight: PASS (0 warnings)
- [ ] Step 5: **deploy.sh — BLOCKED on local DNS** (see Troubleshooting T1)
- [ ] Steps 6–9

## Remaining steps, in order

```bash
# R1. Fix the local DNS cache (one-time, on your Mac)
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder

# R2. Run the deploy (from the resume-app repo root)
export OPERATOR_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)
export BACKEND_CONFIG_ARGS="-backend-config=backend.hcl"
infra/scripts/deploy.sh deploy /Users/aliamin/Documents/Work/touchpoint \
  --app-name touchpoint-rwh --env staging --staging-mode app
# Type "touchpoint-rwh" at the gate. Smoke test WILL fail (exit 2) — empty
# house, expected; the code arrives via CI in R4.

# R3. Put the real MySQL URL in the app's vault (name printed by the script)
az keyvault secret set --vault-name kv-touchpoint-XXXXXXXX \
  --name database-url --value "mysql://<user>:<pass>@<server>/touchpoint_staging"

# R4. Merge the PR (staging...chore/deployment-setup), then set repo secrets:
gh secret set DATABASE_URL_STAGING --repo Recovery-With-Heart/touchpoint \
  --body "mysql://<user>:<pass>@<server>/touchpoint_staging"
# (DATABASE_URL_PRODUCTION + AZURE_* org secrets: steps 8–9 of the table, when
#  CI-to-prod is switched on — not needed for the staging playground)

# R5. Verify
curl -I https://touchpoint-rwh-staging.azurewebsites.net
# 503? restart once so the KV reference resolves:
az webapp restart -g rg-ghr-platform -n touchpoint-rwh-staging
```

**The staging link:** `https://touchpoint-rwh-staging.azurewebsites.net`
(exists in App Service after R2 completes).

---

## What runs where (hands-off map)

| Thing | Who runs it | Where the secret lives |
|---|---|---|
| Build + migrate + deploy on merge to `staging`/`main` | GitHub Actions (repo workflow) | OIDC token in-memory only; DB URL in repo secrets |
| App reads `DATABASE_URL` at runtime | Azure App Service | Key Vault reference → per-app vault, app identity can read ONLY its own vault |
| Infra changes | `deploy.sh` (human-run, typed gate) | Terraform state in `stghrtfstate` (OIDC, blob lease locking) |
| GitHub secrets, workflow values, branches | Human, by hand — **never scripted** | GitHub |

## Troubleshooting

- **T1 — `lookup stghrtfstate.blob.core.windows.net: no such host`:** your Mac's
  DNS cache, not Azure. Run R1. (nslookup may succeed while macOS's own resolver
  fails — trust `ping`, not `nslookup`, for this check.)
- **T2 — smoke test exit 2 right after first deploy:** empty house, expected.
  Code arrives via CI. If it persists after a successful CI deploy, read
  `az webapp log tail -g rg-ghr-platform -n touchpoint-rwh-staging`.
- **T3 — app runs but DB errors:** the KV secret value is wrong or the app
  hasn't restarted since the secret was set (KV references are cached).
- **T4 — `name already exists` at preflight:** app names are globally unique in
  Azure. That's why this deployment is `touchpoint-rwh`, not `touchpoint`.
- **T5 — CI migration step can't reach MySQL:** open "Allow public access from
  any Azure service" on the MySQL server or allowlist GitHub runner IPs.
