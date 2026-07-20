# GHR Deployment Automation — Scope, Human Checkpoints & Accuracy Spec

**Date:** 2026-07-17
**Status:** v2 — amended after OpenCode review (`docs/superpowers/reviews/2026-07-17-ghr-deployment-automation-review.md`). All Critical/Major findings incorporated. Pre-implementation.
**Source:** Ben/Ali weekly, July 16 (Fathom transcript)
**Existing asset:** `AZURE_PLATFORM_SETUP_GUIDE.md` (untested Terraform + GitHub Actions blueprint, ~1700 lines — known to contain blocking bugs, see §7)

---

## 1. Intent & Problem

Josh (GHR) generates app ideas faster than Ali can manually deploy them. Each manual Azure App Service deployment costs 30–40 minutes of click-work (create web app → pick subscription/region → set runtime → wire GitHub → verify). We want a Terraform-based script that takes a GitHub repo URL and produces a working URL, with humans only intervening where judgment is actually needed.

**Goal:** automate the majority of deployment for *simple* apps, keep deliberate human checkpoints (the "human touch" is the productized-service differentiator vs. Render/Vercel-style platforms), and quantify accuracy honestly.

**Benchmark:** Build the script, then prove it by deploying the **Touchpoint staging environment** with it. The benchmark is a *discovery exercise* — every manual nudge it requires becomes a preflight rule or contract field.

## 2. Hard Constraints

- Azure App Service (Linux), region **Canada Central** (GHR requirement).
- **No database provisioning in v1.** Exception: injecting a connection string for an *existing* DB via Key Vault reference (needed for Touchpoint — §7 R1).
- Apps today: Python single-file (`ghr_timesheet_audit_app`), full-stack TS (`touchpoint-main`: client/server/drizzle/vite), pnpm monorepo (`Nursing-Scheduler-main`).
- Never push to `main`; feature branch + PR per CLAUDE.md.
- No secrets in any repo. OIDC (federated credentials) over stored SP secrets.
- **Security baseline for anything inherited from the guide:** the guide contains three Critical defects (Key Vault over-permissioning, `apply -auto-approve`, B1+slots) that must be fixed *before* first apply, not discovered during the benchmark.

## 3. Scope

### In scope (v1)
1. Terraform module `modules/web-app` (hardened rewrite of the guide's module): Linux Web App on a **shared Standard (S1) plan** ("shared" = one plan hosting many apps; never the Azure *Shared/D1* tier, which lacks slots), HTTPS-only, TLS 1.2+, FTP disabled, health-check path, system-assigned identity, tags.
2. **Application Insights resource in the module** (conditional via `enable_app_insights`, default true), wiring `APPLICATIONINSIGHTS_CONNECTION_STRING` into app settings. (Review Issue 8 — the guide never implemented this.)
3. Wrapper CLI: `deploy.sh <github-url> [app-name] [--env staging|prod]` → preflight → plan → **human confirm** → apply → smoke test → print URL. Includes `deploy.sh destroy <app>` with a "never on shared resources" guard. The wrapper is the **only apply path in v1** — no CI auto-apply (Review Issue 2).
4. **Repo contract**: `azure-deploy.json` with `$schema` and `version` fields, validated against a shipped JSON Schema before any custom logic (Review Issue 9). Declares `runtime`, `runtime_version`, `startup_command`, `build_command`, `health_check_path`, non-secret `app_settings`, Key Vault reference map for secrets. Plus a `CLAUDE.md` template with git-flow instructions (main = production, feature branches, pull-before-push).
5. **Preflight validator**: shallow clone via `gh repo clone` (handles private repos, Review Issue 17), schema validation, then structural out-of-contract detection (§6) with a human-readable refusal reason. Also pre-checks Azure name availability before apply (Review Issue 18).
6. Remote state in Azure Storage, **one state key per app** (`apps/<name>.tfstate`) with **state locking** configured (Review Issue 7; verify exact locking mechanism for azurerm v4 backend during implementation).
7. GitHub Actions `deploy.yml` template with **all actions pinned to commit SHAs** (Review Issue 4), `slot-name: ''` for production (never the literal `'production'` — Review Issue 5), and no `environment:` blocks in v1 (Review Issue 15). Org-level OIDC secrets.
8. Slack/GitHub notification with the final URL.
9. Key Vault hardened: **Azure RBAC instead of access policies**, CI principal gets read-only (`Key Vault Secrets User` at most — no `Set`/`Delete`, Review Issue 1), per-app secret scoping or per-app user-assigned identity with `key_vault_reference_identity_id` (Review Issue 6), `purge_protection_enabled = true` + 90-day soft delete for any non-dev deployment (Review Issue 16). Slot-specific secrets handled via `sticky_settings` (Review §2.4).

### Out of scope (v1)
- Database provisioning. (Existing-DB connection string via KV reference only.)
- Custom domains + managed certs.
- Monorepo deployment (Nursing-Scheduler) — preflight must detect and route to human.
- Self-service trigger (repo-created webhook → auto-deploy) — Phase 3.
- `azurerm_app_service_source_control` — rejected for runtime CD (PAT sprawl, weak build control); may resurface in Phase 3 purely for template generation (Review §2.2).
- Auto-scaling, multi-region, blue-green, PR preview environments in templates (deferred; one staging strategy decided per §7 R3 before writing `deploy.yml`).

### Assumptions
- GHR will use a company GitHub org; org-level OIDC acceptable.
- **S1 shared plan is approved** (~$73/mo) — required for slots; blocking decision (§7 R3).
- Josh's new apps are overwhelmingly "simple."

## 4. Options Considered

- **Option A: Terraform + wrapper script, run manually by Ali (chosen for Phase 1).** Pros: fastest to value, testable, human gate trivial to keep, no auto-apply risk. Cons: one human command per app (~2 min). Effort: Medium.
- **Option B: Azure-native source control via Terraform.** Rejected for v1 (stored PAT, weak build control); note it can generate Actions workflows, possible Phase 3 reuse.
- **Option C: Skip to full self-service (webhook → auto-apply).** Deferred to Phase 3 — building the trigger before the engine is proven is backwards.

**Decision:** Option A. Trade-off accepted: first deploy of each app needs one human-run command until Phase 3.

## 5. Automation vs. Human Touch — the Finalized Split

Accuracy labels: **Deterministic** = works given correct implementation + normal Azure API behavior; **High** = fails occasionally on naming/quota/provider edge cases; **Variable** = depends on repo conformance.

| # | Deployment step | Automated? | Realistic level |
|---|---|---|---|
| 1 | Resource group + shared S1 plan selection | ✅ | Deterministic (root module, one-time) |
| 2 | Web App creation (name, region, runtime) | ✅ | High — name collisions/quota are real failure modes |
| 3 | Runtime/startup config | ✅ | High for Node; Variable for Python (startup command is the classic failure point) |
| 4 | Non-secret app settings | ✅ | Deterministic (from contract) |
| 5 | Secret env vars | ⚠️ semi | Human sets once via KV; script wires references. KV refs are **not validated at deploy time** — smoke test must catch literal-string failures |
| 6 | GitHub CI deploy wiring | ✅ | High (OIDC subject-format caveat, §7 R4) |
| 7 | Build + first deploy | ✅ | Variable — depends on repo layout conformance |
| 8 | Security defaults (HTTPS, TLS, FTP off, purge protection) | ✅ | Deterministic (Terraform-enforced) |
| 9 | Health check + App Insights + logs | ✅ | High — App Insights now in module scope (was falsely claimed 100% before review) |
| 10 | URL output + notification | ✅ | Deterministic |
| 11 | Post-deploy verification | ⚠️ semi | Automated smoke test (HTTP 200, retries 3×/3 min) + human eyeball |
| 12 | Failure triage | ❌ human | The core human service |
| 13 | Domains, DB provisioning, workers, monorepos | ❌ human | Detected by preflight where structurally visible |

**Human checkpoints (deliberate — this is the service, and each has a concrete procedure):**
1. **Preflight gate** — script prints app summary + plan; human confirms before apply (~2 min).
2. **Secrets injection** — human sets secrets once per app in KV; documents cache/restart behavior (KV refs cached; secret rotation requires app restart).
3. **Post-deploy eyeball** — smoke test gate + one human click of the URL.
4. **Triage on failure** — logs surfaced to Slack; human fixes; **every failure pattern gets fed back into preflight rules or contract fields** (written procedure, not aspiration). This loop is what moves accuracy up over time.

## 6. Accuracy Estimate (honest, post-review)

Accuracy is a function of repo contract conformance.

| Scenario | v1 first-attempt success | Phase 2/3 target |
|---|---|---|
| In-contract simple app | **60–80%** | 85–95% (after Touchpoint + 2–3 real apps feed the failure loop) |
| In-contract but needs a nudge (startup cmd, missing env var) | 15–30% of apps | 5–15% |
| Structurally out-of-contract (monorepo, DB provisioning, workers) | Refused by preflight | Refused by preflight |

**What preflight can and cannot promise (Review Issue 11):**
- *Detectable statically (~all cases):* `pnpm-workspace.yaml`/monorepo markers, `drizzle.config.*` or ORM config without a declared KV secret, `Dockerfile`, `worker/`/process managers, missing contract file, schema violations.
- *NOT detectable statically:* native Python deps, private npm packages, non-standard build scripts, port-binding mistakes, runtime network requirements. These are caught by the **smoke test + triage loop**, not preflight.
- **Softened claim:** Terraform can partially apply and Azure can report success on a misconfigured app. The design aims to *fail fast and surface errors*; it does not guarantee zero silent failures. Smoke test covers HTTP liveness only — not broken internal API routes or missing DB migrations.

**Bottom line for Ben:** expect the first few apps (including Touchpoint) to each need 10–30 min of human nudging; by app #3–4 the failure-feedback loop should bring first-attempt success into the 80%+ range. The "80–90%" figure from the meeting is the *steady-state* target, not week-one reality.

## 7. Risks

- **R1 (Critical): Touchpoint has a database (drizzle).** Mitigation: contract permits KV references to an *existing* DB URL; script provisions zero DB resources. If staging needs a *new* DB, it's created manually once. Open question O2.
- **R2 (Critical, from review): Inherited blueprint bugs block the benchmark.** (a) Guide defaults B1 + creates slot = apply fails → **S1 default, slot conditional on SKU validation**. (b) `deploy.yml` uses invalid `slot-name: 'production'` → fixed in template. (c) Key Vault broad access policies + no purge protection → RBAC hardening in scope. (d) `terraform.yml` has `apply -auto-approve` → v1 uses wrapper-only applies; any future CI apply requires a GitHub Environment approval gate.
- **R3 (Major): Staging strategy decision.** S1 shared plan + slots (assumed) vs per-app B1 staging apps. Must be decided **before** writing `deploy.yml` — one template, not two. Slot staging sets `always_on = true` on S1 (Review Issue 13).
- **R4 (Major): OIDC trust design.** Wildcard `repo:org/*` is supported but broad (any repo in org gets tokens), and GitHub's immutable `sub` claims (default for repos created after 2026-07-15) use numeric IDs — name-based wildcards may not match new repos. Phase 1 task: verify org's OIDC subject format; design least-privilege trust (environment-scoped or per-repo credential template).
- **R5 (Minor): Build-strategy conflict.** Guide sets both `WEBSITE_RUN_FROM_PACKAGE=1` and `SCM_DO_BUILD_DURING_DEPLOYMENT=true` — pick one per runtime, documented (default: Oryx build, no run-from-package).
- **R6 (Minor): Name collisions.** Preflight checks Azure name availability; fallback naming `ghr-<app>-<env>-<4char hash>`.

**Rollback:** `deploy.sh destroy <app>` (per-app isolated state makes this safe; shared plan/KV/RG explicitly excluded). Runbook: exact commands, required permissions, mid-apply-failure state recovery. Platform-level resources never destroyed by automation.

## 8. Implementation Plan

**Phase 1 — module + script + Touchpoint benchmark (realistic: 2–3 weeks; "week or two" only if R3/O2 resolve immediately):**
1. Branch `feature/ghr-deploy-automation`; `infra/` root module + hardened `modules/web-app` on azurerm ~> 4.x (re-validate all schemas — v3→v4 breaking changes), KV RBAC model, S1 default with slot SKU validation, conditional App Insights, remote backend + locking → `terraform validate` clean. *Effort: M.*
2. `azure-deploy.json` JSON Schema + versioned contract + preflight validator (gh clone, schema check, structural detection, name availability). *Effort: S–M.*
3. `deploy.sh` wrapper (preflight → plan → confirm → apply → smoke test → URL) + `destroy` subcommand + runbook. *Effort: S.*
4. Template repo content: SHA-pinned `deploy.yml` (fixed slot logic), `CLAUDE.md`, `REGISTER.md`; OIDC trust per R4. *Effort: S.*
5. **Benchmark: Touchpoint staging.** Pre-define success = staging URL serving HTTP 200 with DB connectivity, zero manual Azure portal steps. Log every nudge → convert each into a preflight rule/contract field. *Effort: M.*
6. Replace §6 estimates with measured results.

**Phase 2:** Josh's next app end-to-end via template; Slack notifications; weekly failure-log review; accuracy toward 85%.
**Phase 3:** Registration automation (PR-based tfvars with **approval-gated** apply, or repo-created webhook); optional self-service UI only if volume justifies it.

## 9. Open Questions

1. **S1 shared plan (~$73/mo) approved?** Blocks slots and Phase 1. *(Ben — top priority)*
2. Touchpoint staging DB: new or existing? Who creates it? *(Ali/Ben)*
3. GHR GitHub org name confirmed? Needed for OIDC + private-repo access. *(Ali)*
4. Slack channel for deploy notifications? *(Ben)*
5. GHR org repos created after 2026-07-15 — verify OIDC `sub` claim format before designing federated credentials. *(Ali, during task 4)*

---

## Amendment 2026-07-20: Branch → environment model

Decision (Ali): all current and future apps use a fixed two-branch model —
`staging` branch deploys the staging app + staging DB, `main` deploys the
production app + production DB. Flow: feature → PR → `staging` → verify → PR →
`main`.

Implemented as:

- **Workflow template** triggers on pushes to both branches; a `resolve` job
  maps branch → target (main→production, staging→staging) and computes
  app/slot names per `STAGING_MODE`. OIDC permission (`id-token: write`) is now
  scoped to the deploy job only.
- **Database migrations run in CI** via new contract field
  `db_migration_command` (schema v1 extended; e.g. `npm run db:push` for
  drizzle). Runs after deps install, before code deploy, against the target
  branch's database. Connection strings come from repo secrets
  `DATABASE_URL_STAGING` / `DATABASE_URL_PRODUCTION` (operator-created; the
  deploy SP intentionally still has no Key Vault data-plane access, so KV can't
  be the CI source). Migrations must be backward-compatible + forward-only —
  enforced socially via the app-repo CLAUDE.md, which is also why migrations
  run *before* code deploy.
- **preflight** warns when DB markers + `kv_secrets` exist but
  `db_migration_command` is missing (schema changes would silently not apply).
- **deploy.sh `--branch`** selects which branch is cloned for validation;
  ongoing branch deploys never touch deploy.sh (CI-only concern).
- Docs updated: infra README §3.1, app-repo CLAUDE.md (new git flow), REGISTER.md.

Open follow-up: database *provisioning* remains manual (one command per
environment); automating per-app DB creation is a Phase 2 candidate now that
the branch model makes staging DBs a first-class concept.
