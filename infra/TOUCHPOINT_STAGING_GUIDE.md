# Touchpoint Staging — Full Picture from Step 0 (Case B)

**What this is:** the complete, ordered story of deploying Touchpoint's staging
environment with the automation — what happens, when, why, what access each step
needs, and every mistake we made getting here so nobody repeats them.

**Target end state:** `https://touchpoint-rwh-staging.azurewebsites.net` serving
the `staging` branch, wired to a `touchpoint_staging` MySQL DB, auto-deploying
on every merge to `staging`. Case B = separate staging web app on a cheap B1
shared plan (~$13/mo), no slots.

---

## 0. Current state (2026-07-23 — nearly done)

| Thing | State |
|---|---|
| Platform (`rg-ghr-platform` + B1 plan, canadaeast, app mode) | **APPLIED** |
| Staging app `touchpoint-rwh-staging.azurewebsites.net` | **DEPLOYED with `--no-prod`** (the unrequested pair-prod was destroyed per the "create only what was requested" rule) |
| `touchpoint_staging` DB on `touchpoint-server` | **CREATED + all migrations applied** |
| Secrets mode | **Env-var**: `DATABASE_URL` is a plain app setting (staging-only pattern); per-app Key Vault destroyed (soft-deleted, 90-day name hold) |
| OIDC (Azure side) | **DONE**: `ghr-github-deploy` — APP_ID `4afaa68e-0ba3-4ea8-b404-d130d512d2e6`, SP object id `3207861b-515f-4529-8b9b-131991d15081`; federated creds for `staging` + `main`; Website Contributor on the staging app |
| GitHub: `staging` branch + `chore/deployment-setup` PR | **KEPT** — PR: https://github.com/Recovery-With-Heart/touchpoint/compare/staging...chore/deployment-setup |
| tfstate storage (`stghrtfstate`) | Kept |
| MySQL firewall rule `ali-local-temp` (your current IP) | Added to run migrations from your Mac — delete later if unneeded |

## Remaining — 3 manual GitHub steps (~10 min, ALL repo-level)

Secrets are set at REPO level (repo → Settings → Secrets and variables →
Actions → New repository secret) — chosen over org-level for tighter scoping;
the OIDC federated credential is already per-repo.

```bash
# R1. Repository secrets on Recovery-With-Heart/touchpoint:
#   AZURE_CLIENT_ID       = 4afaa68e-0ba3-4ea8-b404-d130d512d2e6
#   AZURE_TENANT_ID       = 3490d3c3-0a4c-4d0b-9ed1-0ca213d5866e
#   AZURE_SUBSCRIPTION_ID = 795e869f-d45a-4377-8f5d-81b20ecd418a
#   DATABASE_URL_STAGING  = mysql://<user>:<password>@touchpoint-server.mysql.database.azure.com:3306/touchpoint_staging?ssl={"rejectUnauthorized":true}

# R2. Merge the PR (staging ← chore/deployment-setup):
#     https://github.com/Recovery-With-Heart/touchpoint/compare/staging...chore/deployment-setup
#     The merge IS a push to staging → triggers the deploy workflow automatically.

# R3. Watch repo → Actions (build → migrate → deploy, ~4-6 min), then:
curl -I https://touchpoint-rwh-staging.azurewebsites.net
# 503 after green? az webapp restart -g rg-ghr-platform -n touchpoint-rwh-staging
```

**Housekeeping:** the prod DB password was pasted in chat — rotate it in the
MySQL server when convenient, then update the staging app setting +
`DATABASE_URL_STAGING` with the new value.

---

## Permanent split (decision 2026-07-26, locked)

For THIS app, the two pipelines are permanent:

| Branch | Pipeline | Deploys to |
|---|---|---|
| `main` | **Legacy** `main_touchpoint.yml` (Azure-generated) | Legacy prod `touchpoint-bjanbefcbrfpd8cn` (real production) |
| `staging` | **New** `deploy.yml` (this automation) | `touchpoint-rwh-staging` (managed staging playground) |

- There is NO cutover. The managed prod app is never provisioned;
  `DATABASE_URL_PRODUCTION` is never needed for the new pipeline.
- The new workflow's trigger stays `branches: [staging]` permanently — do not
  add `main` unless this decision is explicitly revisited.
- Merging `staging` → `main` promotes code to legacy prod via the legacy
  pipeline, as before. The new pipeline only ever sees the staging branch.

---

## 1. The full sequence — what, when, why

### Phase A — platform plumbing (once, ever, for ALL apps)

| Step | What | When | Why |
|---|---|---|---|
| A1 | Machine tools: terraform, az CLI, `pip3 install --user --break-system-packages jsonschema`, git | Once | The script's only dependencies. `git` alone is enough (`gh` optional). jsonschema is a hard deploy requirement |
| A2 | tfstate storage account + container | Once | Holds Terraform state remotely with blob-lease locking. `use_oidc` = no keys stored |
| A3 | OIDC app registration + GitHub org secrets (`AZURE_CLIENT_ID`/`TENANT_ID`/`SUBSCRIPTION_ID`) | Once, **only when CI deploys** (not needed for the first manual staging run) | Lets GitHub Actions get short-lived Azure tokens with zero stored secrets. Manual by design — automation touches Azure only |

### Phase B — shared platform + data (once per platform)

| Step | What | When | Why |
|---|---|---|---|
| B1 | `infra/platform`: tfvars (`location="canadaeast"`, `app_service_sku="B1"`, `staging_mode="app"`) → `terraform init -backend-config=backend.hcl` → `apply` | **NOW — first thing after reset** | One cheap home for every app. canadaeast matches existing prod. B1+app-mode = the ~$13/mo scenario (no S1 needed) |
| B2 | Create MySQL DB `touchpoint_staging` + `DATABASE_URL=... npm run db:push` | Before C4 (CI needs it) | **Automation never creates databases** — data is the risky thing. Staging must never share prod's DB |

### Phase C — the app (once per app)

| Step | What | When | Why |
|---|---|---|---|
| C1 | Repo carries `azure-deploy.json` + `.github/workflows/deploy.yml` + `staging` branch | **DONE** | Repo = source of truth; app and its deploy config can't drift |
| C2 | `deploy.sh deploy` (typed-name gate) creates the app pair + per-app Key Vault + RBAC + App Insights | After B1 | Codified, reviewable infra with a human checkpoint. `--staging-mode app` must match B1's tfvars |
| C3 | `az keyvault secret set` — the real MySQL URL (staging DB) | After C2 (vault exists) | Terraform wires the *reference*; a human enters the *value*. Secrets never touch git/state |
| C4 | Merge the chore PR to `staging`; set repo secret `DATABASE_URL_STAGING`; CI builds → migrates → deploys | After C3 | Merging IS the deploy button. Repo secret is manual (automation = Azure only) |
| C5 | `curl -I https://touchpoint-rwh-staging.azurewebsites.net` (503 → restart app once) | After C4 | KV references are cached; a restart resolves them the first time |

### Phase D — daily life (zero access): feature → PR → `staging` → verify → PR → `main`.

---

## 2. Access & why (minimal, hands-off)

| Access | Held by | Needed for | Scope |
|---|---|---|---|
| Your `az login` (Contributor on sub) | You, locally | Phases A–C terraform applies + KV secret | The only Azure credential anywhere; nothing stored |
| MySQL admin | You | B2 | One database create, one migration run |
| GitHub push/admin on the repo | You | C1, C4 (branches, PR merge, repo secrets) | Repo only |
| Entra ID App Administrator | You (later, A3) | OIDC registration | Once, platform-wide |
| GitHub Actions deploy SP | Azure (OIDC) | CI deploys | **Website Contributor per app only** — never RG-wide, never Key Vault data-plane |

---

## 3. Mistakes we made (the honest log)

| # | Mistake | Cost | Fix / lesson (now in docs) |
|---|---|---|---|
| 1 | **I treated the `touchpoint-main` zip extract as a git repo** — it has no `.git`, so nothing reached GitHub and you found no staging branch | Your time + frustration | Always verify `.git` before git operations. The real repo is `/Users/aliamin/Documents/Work/touchpoint` |
| 2 | **My guide taught the `--contract` shortcut before the repo-first design**, so Step 3 made no sense and you had to ask | Confusion | README §3 rewritten: repo files are committed FIRST; `--contract` documented as test-only |
| 3 | App name `touchpoint` is **globally taken** on Azure | One failed run | Preflight's name check caught it early (worked as designed); renamed `touchpoint-rwh` |
| 4 | `jsonschema` missing; plain `pip3 install --user` blocked by PEP 668 on modern macOS | One failed run | Install with `--break-system-packages`; now in the prereqs |
| 5 | `infra/app/backend.hcl` didn't exist — deploy can't reach state without it | One failed run | Created (platform backend config minus the `key`); now in this guide (B1 note) |
| 6 | **macOS DNS cache couldn't resolve the blob-storage host** while `nslookup` succeeded | Blocked deploy, debugging detour | `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`. Trust `ping`, not `nslookup`, for this check |
| 7 | Template assumed **npm**; Touchpoint uses **pnpm** | Would have failed in CI | Touchpoint's workflow copy uses `corepack` + `pnpm install --frozen-lockfile` |
| 8 | Contract said Node **20**; Touchpoint's CI builds on **22** | Version drift | Contract + workflow set to 22 |
| 9 | Repo file is `claude.md` (lowercase) — my first commit missed it (case) | One extra commit | Stage exact paths; macOS FS is case-insensitive, git is not |
| 10 | **My communication**: too much debugging noise, answers buried | Your patience | Guides now lead with the answer, details after |
| 11 | **The script created an unrequested PRODUCTION app** alongside staging (pair-always default) — you asked for staging only | An idle prod app until destroyed the same day | Hard rule: create ONLY what was requested. `--no-prod` flag added (requires app mode); README §9 rule 11; re-running with it destroyed the stray prod app |
| 12 | **Workflow kept `AZURE_WEBAPP_NAME: touchpoint`** after the app was renamed `touchpoint-rwh` at provision time | CI deploy failed: "Resource touchpoint-staging doesn't exist" | Rename + workflow update happen in the same breath (runbook 8b) |
| 13 | **Oryx rebuilt the app server-side with npm** on a pnpm repo with loose peer deps (`valibot` conflict) — the template's double-build flaw | Zip deploy failed at Azure build despite CI build being green | `NPM_CONFIG_LEGACY_PEER_DEPS=true` on the app; deploy.sh now auto-adds it for pnpm repos (runbook 9a) |
| 14 | **Server build skipped devDependencies** (`NODE_ENV=production` → npm omits devDeps → `vite: not found`) — third failure of the same double-build component | Another red deploy, one step further along | `NPM_CONFIG_PRODUCTION=false`. **Lesson accepted: stop patching the double-build — replace it with single-build (CI builds, server extracts + runs). Template v1.1.** |

---

## 4. Copy-paste: from here to done

```bash
# B1 — platform (5 min). tfvars already has canadaeast/B1/app; backend.hcl exists.
terraform -chdir=infra/platform init -backend-config=backend.hcl -reconfigure
terraform -chdir=infra/platform apply        # type: yes

# B2 — staging DB (if not done): create touchpoint_staging on the MySQL server, then
cd /Users/aliamin/Documents/Work/touchpoint
DATABASE_URL="mysql://<user>:<pass>@<server>/touchpoint_staging" npm run db:push && cd -

# C2 — the deploy (type "touchpoint-rwh" at the gate; smoke test exit 2 = expected)
export OPERATOR_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)
export BACKEND_CONFIG_ARGS="-backend-config=backend.hcl"
infra/scripts/deploy.sh deploy /Users/aliamin/Documents/Work/touchpoint \
  --app-name touchpoint-rwh --env staging --staging-mode app

# C3 — the secret (vault name is printed by the script)
az keyvault secret set --vault-name kv-touchpoint-XXXXXXXX \
  --name database-url --value "mysql://<user>:<pass>@<server>/touchpoint_staging"

# C4 — merge the PR to staging, then:
gh secret set DATABASE_URL_STAGING --repo Recovery-With-Heart/touchpoint \
  --body "mysql://<user>:<pass>@<server>/touchpoint_staging"

# C5 — verify
curl -I https://touchpoint-rwh-staging.azurewebsites.net
```

If C2 hits the DNS error again: `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`, retry. Everything else is idempotent — re-running any step is safe.
