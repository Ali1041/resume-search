# Critique: GHR Deployment Automation Spec

**Date:** 2026-07-17  
**Spec reviewed:** `docs/superpowers/specs/2026-07-17-ghr-deployment-automation.md`  
**Existing blueprint reviewed:** `AZURE_PLATFORM_SETUP_GUIDE.md`  
**Review type:** Pre-implementation critique (no code implemented)  

---

## 1. Scope & Purpose of This Review

This review evaluates the GHR Deployment Automation spec against the stated intent (automate ~80–90% of simple Azure App Service deployments with human checkpoints) and the untested blueprint it builds on. It focuses on four areas requested by the author:

1. Gaps in scope, planning, or operational procedure.
2. Wrong Azure or Terraform assumptions.
3. Security issues.
4. Unrealistic accuracy claims.

In addition, four specific provider claims are verified against current Terraform and Azure documentation.

---

## 2. Verified Claims About AzureRM/Azure Behavior

### 2.1 Deployment slots require Standard SKU (S1+) — **Mostly Correct, but wording is ambiguous**

Azure deployment slots are **not** available on Free, Shared, or Basic App Service plans. The minimum supported SKU for slots is **Standard (S1)**. The guide's default `B1` plan cannot host a `azurerm_linux_web_app_slot` resource; a `terraform apply` with the default variables would fail.

- **Spec R3 correctly identifies this** and flags the need for an S1 decision.
- **Problem:** The spec uses the word "shared" as a generic descriptor ("shared App Service Plan") while Azure also has a literal **Shared tier** (`D1`). In Azure, "Shared" means something specific: a D1/Shared plan has no deployment slots, no always-on, no custom domains, and no SSL. If the intent is "one Standard plan shared by many apps," say **"shared Standard (S1) plan"** explicitly.
- **Recommendation:** Change every occurrence of "shared plan" to "shared S1 (or higher) plan" and make the SKU a required variable with validation.

### 2.2 `azurerm_app_service_source_control` / Azure native source control — **Correctly characterized, but slightly oversimplified**

The Terraform resource `azurerm_app_service_source_control` exists and can configure Azure-native source control for a Web App. Verified from the provider docs (v4.x): it supports `repo_url`, `branch`, `github_action_configuration`, `use_manual_integration`, and `rollback_enabled`. For native continuous deployment from GitHub (webhooks), Azure historically requires a GitHub authorization token (PAT or OAuth-granted token) stored in Azure. The resource can also generate a GitHub Actions workflow file, in which case the runtime deployment is via Actions rather than Azure-native CD.

- **Spec's rejection of Option B is reasonable** for v1: PAT sprawl, weak monorepo support, and flakiness are real concerns.
- **Nuance:** The resource is not deprecated and can be useful later for auto-generating `deploy.yml` in a template repo. The spec does not need to treat it as a dead-end.
- **Recommendation:** Keep Option B rejected for v1, but add a note that `azurerm_app_service_source_control` may resurface in Phase 3 for template-repo generation, not runtime CD.

### 2.3 OIDC federated credential wildcards (`repo:org/*`) — **Supported, but two breaking changes are missing**

Azure AD / Microsoft Entra workload identity federation **does** support wildcard patterns in the `subject` field of federated credentials. The pattern `repo:your-org/*:ref:refs/heads/main` is valid and documented in Azure examples. The spec's R4 is technically correct.

However, the spec omits two important caveats:

1. **GitHub is moving to immutable default OIDC subject claims for repos created after 2026-07-15.** The new default `sub` includes numeric repository/owner IDs instead of names (`repo:<owner-id>:<repo-id>:...`). A wildcard based on the org *name* will not match a repository using the new immutable format. The spec must decide whether to pin the legacy format, use claim-based conditions, or create a per-repo credential template.
2. **Wildcard subjects are broad.** Any repository in the org can obtain the token. The spec should add a secondary condition (e.g., environment name, custom property, or `repository_id` claim) to constrain access.

- **Recommendation:** Add a Phase 1 task to evaluate the org's OIDC subject format and design a least-privilege trust policy rather than relying solely on `repo:org/*`.

### 2.4 Key Vault references in `app_settings` — **Correct syntax, but runtime behavior is more complex than implied**

Azure App Service supports Key Vault references in app settings using the syntax:

```
@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<name>/<version>)
```

The spec's R1 mitigation and the guide's example are syntactically correct. The app service's managed identity needs `Get` permission on the secret.

Important caveats the spec does not cover:

- **References are resolved at runtime and cached.** If the secret value changes, the app must be restarted or the app setting must be edited to invalidate the cache.
- **Key Vault references are not validated at deployment time.** A typo in the URI or missing permission will cause the app setting to contain the literal string, not the secret value. The app may fail with a confusing error.
- **User-assigned identity is often better than system-assigned.** The provider supports `key_vault_reference_identity_id` for explicit control.
- **Slot swap behavior:** If a Key Vault reference app setting should stay slot-specific (e.g., staging vs. production DB URL), it must be listed in `sticky_settings.app_setting_names` or the slot must have its own explicit `app_settings` override.

- **Recommendation:** Document the cache/restart behavior in the contract template and add `sticky_settings` handling for slot-specific secrets.

---

## 3. Critical Issues

### Issue 1: Key Vault access policy grants GitHub Actions SP full secret management
- **Severity:** Critical (Security)
- **Location:** Guide `main.tf` (Key Vault access policy) and Spec §5 ("secrets injection")
- **Description:** The guide grants the GitHub Actions service principal `Get`, `List`, `Set`, `Delete` on the shared Key Vault. The spec does not challenge this. If the OIDC credential is compromised or a workflow is poisoned, an attacker can read, modify, or delete all secrets in the vault.
- **Impact:** Lateral movement across all GHR apps; complete secret exposure; ability to inject malicious connection strings or API keys.
- **Suggestion:** Remove `Set` and `Delete` from the CI policy. Use Azure RBAC (`Key Vault Secrets User` for the app, `Key Vault Reader` or `Key Vault Secrets User` for CI) instead of the legacy access policy. If CI needs to write secrets, scope it to a separate deployment-only vault or use a per-app secret scope.

### Issue 2: `terraform apply -auto-approve` in the infrastructure workflow
- **Severity:** Critical (Security / Operational)
- **Location:** Guide `.github/workflows/terraform.yml`
- **Description:** The guide runs `terraform apply -auto-approve` on every push to `main` after a `continue-on-error` plan. The spec says "human gate" for the wrapper script but does not address the inherited infra workflow. Auto-approval of infrastructure changes with no human review is dangerous, especially when a `pull_request` trigger can influence state via the PR comment step.
- **Impact:** A malicious or mistaken `tfvars` change can destroy or reconfigure all GHR apps immediately.
- **Suggestion:** Add an explicit approval gate (GitHub Environment protection rule or a manual `workflow_dispatch`) for the apply job. For v1, keep the wrapper script as the only apply path and remove the auto-apply from the inherited `terraform.yml`.

### Issue 3: Deployment slots are created on a plan that defaults to B1
- **Severity:** Critical (Correctness)
- **Location:** Guide `main.tf` (`sku_name = var.app_service_sku`, default B1) and `modules/app-service/main.tf` (`azurerm_linux_web_app_slot`)
- **Description:** The guide defaults to B1 but creates a staging slot. B1 does not support slots. The first `terraform apply` will fail unless the operator knows to override `app_service_sku` to S1 or higher.
- **Impact:** The spec's benchmark (Touchpoint staging) cannot be deployed without first fixing the SKU. This blocks the entire Phase 1 timeline.
- **Suggestion:** Set the default SKU to `S1` and add a variable validation block that rejects B1 if `create_staging_slot = true`. Make the staging slot conditional via a feature flag.

---

## 4. Major Issues

### Issue 4: GitHub Actions actions use floating major tags
- **Severity:** Major (Security)
- **Location:** Guide `.github/workflows/deploy.yml` and `.github/workflows/terraform.yml`
- **Description:** `actions/checkout@v4`, `actions/setup-node@v4`, `azure/login@v1`, `azure/webapps-deploy@v3`, `actions/github-script@v7`, etc. use mutable major tags. A compromised action publisher can retag a malicious commit and compromise the supply chain.
- **Impact:** Supply-chain attack surface across every GHR app and the infra repo.
- **Suggestion:** Pin all actions to a full commit SHA in the templates, with a comment noting the human-readable version. Add a dependabot/renovate policy to propose SHA updates.

### Issue 5: `deploy.yml` template uses `slot-name: 'production'`, which is invalid
- **Severity:** Major (Correctness)
- **Location:** Guide `.github/workflows/deploy.yml`, step "Deploy to Azure Web App"
- **Description:** The `azure/webapps-deploy@v3` action's `slot-name` input expects the name of a deployment slot (e.g., `staging`) or empty/omitted for the main production app. Passing the literal string `'production'` is not a valid slot name and will cause the deployment to fail or deploy to the wrong target.
- **Impact:** The template inherited by every GHR app is broken out of the box.
- **Suggestion:** Use `slot-name: ${{ github.event_name == 'pull_request' && 'staging' || '' }}` and verify the staging slot name matches the Terraform slot name.

### Issue 6: System-assigned identity has broad Key Vault access with no secret scoping
- **Severity:** Major (Security)
- **Location:** Guide `modules/app-service/main.tf` (`azurerm_key_vault_access_policy.app`)
- **Description:** Each app gets `Get` on **all** secrets in the shared Key Vault via an access policy. If one app is compromised, the attacker can read every secret in the vault (e.g., other apps' DB URLs, API keys).
- **Impact:** Lateral movement between GHR apps; breach of one app becomes breach of many.
- **Suggestion:** Prefer Azure RBAC with per-secret role assignments (`Key Vault Secrets User` scoped to individual secrets), or use a dedicated Key Vault per app. At minimum, use `key_vault_reference_identity_id` and a user-assigned identity per app.

### Issue 7: No Terraform state locking configuration
- **Severity:** Major (Completeness / Operational)
- **Location:** Spec §5 and §8 (state storage)
- **Description:** The spec mentions "Remote state in Azure Storage, one state key per app" but never mentions locking. Azure Storage backend supports state locking via a table, but only if configured. Without locking, concurrent `terraform apply` runs (e.g., two apps deployed simultaneously or CI and local wrapper colliding) can corrupt state.
- **Impact:** State corruption, duplicated resources, or failed applies.
- **Suggestion:** Add an Azure Storage Table for state locking and document it in both the wrapper script and CI workflow. Example backend config:
  ```hcl
  backend "azurerm" {
    storage_account_name = "..."
    container_name       = "tfstate"
    key                  = "apps/<name>.tfstate"
    use_oidc             = true
    use_msi              = false
  }
  ```
  (Note: Table-based locking is automatic when the backend finds a table named `terraform-state-lock` or when `lock_table_name` is set in older versions; verify the exact setting for azurerm v4.)

### Issue 8: App Insights is claimed as 100% automated but not implemented in the module
- **Severity:** Major (Completeness / Correctness)
- **Location:** Spec §5 table (row 9) and Guide §14 "Enable Monitoring" / module
- **Description:** The spec lists "Health check + App Insights + logs" as 100% automated. The guide mentions Application Insights in the troubleshooting/monitoring section but the actual `modules/app-service` module does not create an `azurerm_application_insights` resource or wire it into the web app. The health check path is set, but no App Insights instrumentation key or connection string is configured.
- **Impact:** The claim is false for the inherited blueprint. Phase 1 will not deliver App Insights without extra work.
- **Suggestion:** Add an `azurerm_application_insights` resource to the module, output its connection string, and set `APPLICATIONINSIGHTS_CONNECTION_STRING` in `app_settings`. Make it conditional if cost is a concern.

### Issue 9: No schema validation or versioning for `azure-deploy.json`
- **Severity:** Major (Completeness)
- **Location:** Spec §3.3 (contract)
- **Description:** The spec defines an `azure-deploy.json` contract but does not specify a JSON Schema, version field, or how the preflight validator will report errors. Without a schema, the contract will drift as new fields are added and the validator will become a pile of ad-hoc checks.
- **Impact:** Maintenance burden, inconsistent error messages, and hidden failures.
- **Suggestion:** Add a `$schema` and `version` field to `azure-deploy.json`, ship a JSON Schema file, and validate against it before custom logic.

### Issue 10: The accuracy table claims 100% for several steps that are not 100%
- **Severity:** Major (Accuracy / Feasibility)
- **Location:** Spec §5 and §6
- **Description:** The spec assigns 100% accuracy to: resource group/plan selection, web app creation, non-secret app settings, security defaults, health check + App Insights + logs, URL output, and notifications. These depend on correct implementation, provider behavior, and Azure API availability. For example, web app creation can fail due to name collisions, quota limits, or provider schema changes; security defaults can be silently overridden by provider defaults; and App Insights is not even in the module.
- **Impact:** Over-promising to stakeholders and underestimating risk.
- **Suggestion:** Replace 100% claims with "high (assuming no naming/region/quota issues)" or remove the precision. Reserve 100% for steps that are genuinely deterministic and already implemented.

### Issue 11: Preflight cannot detect 100% of out-of-contract repos
- **Severity:** Major (Accuracy)
- **Location:** Spec §6
- **Description:** The spec claims static file inspection can detect out-of-contract repos with ~100% accuracy. This is unrealistic. Many failure modes are not visible in file names: native Python dependencies, private npm packages, non-standard build scripts, `node:` built-ins, large files, apps requiring outbound network access, etc.
- **Impact:** The "safety" claim is misleading. The system will still silently half-fail on some repos after passing preflight.
- **Suggestion:** Re-frame the claim: preflight catches *known* structural out-of-contract patterns; unknown runtime failures are handled by the post-deploy smoke test and triage loop. Provide a concrete list of detectable patterns and a separate list of runtime-only risks.

---

## 5. Minor Issues

### Issue 12: `SCM_DO_BUILD_DURING_DEPLOYMENT` and `WEBSITE_RUN_FROM_PACKAGE` together
- **Severity:** Minor (Correctness)
- **Location:** Guide `modules/app-service/main.tf`
- **Description:** The guide sets both `WEBSITE_RUN_FROM_PACKAGE = "1"` and `SCM_DO_BUILD_DURING_DEPLOYMENT = "true"`. When using zip deploy with `WEBSITE_RUN_FROM_PACKAGE=1`, the app runs from the package directly. `SCM_DO_BUILD_DURING_DEPLOYMENT` is intended for zip deploy where the package is extracted and built by Kudu. The combination can cause confusing behavior or double-builds.
- **Impact:** Unpredictable build/deploy behavior for some runtimes.
- **Suggestion:** Choose one strategy per runtime and document it. For Oryx-based builds, prefer `SCM_DO_BUILD_DURING_DEPLOYMENT=true` with a zip deploy and no run-from-package. For pre-built artifacts, use `WEBSITE_RUN_FROM_PACKAGE=1` only.

### Issue 13: Staging slot `always_on = false` may cause swap failures
- **Severity:** Minor (Correctness / Operational)
- **Location:** Guide `modules/app-service/main.tf` (`azurerm_linux_web_app_slot.staging`)
- **Description:** The guide sets `always_on = false` on the staging slot. On Standard+ plans, `always_on` can be true. A cold staging slot can return 502s during a swap or when the first PR request warms it up.
- **Impact:** Intermittent PR preview failures.
- **Suggestion:** Set `always_on = true` for the staging slot when using an S1+ plan, or set it to false only when using a plan that requires it.

### Issue 14: The `terraform.yml` plan step has undefined references and weak error handling
- **Severity:** Minor (Correctness)
- **Location:** Guide `.github/workflows/terraform.yml`
- **Description:** The "Update Pull Request" step uses `steps.fmt.outcome` and `steps.validate.outcome` but no steps named `fmt` or `validate` are defined with an `id`. The plan step uses `continue-on-error: true` and then a separate status step, which is brittle. Also, the plan output is posted as a PR comment and may leak sensitive resource names or configuration.
- **Impact:** Broken PR comments; potential information disclosure.
- **Suggestion:** Add `id: fmt` and `id: validate` to the respective steps. Consider posting a plan summary rather than the full plan, or restrict plan output to authorized reviewers.

### Issue 15: `deploy.yml` uses GitHub environments named `staging` and `production` without defining them
- **Severity:** Minor (Correctness / Operational)
- **Location:** Guide `.github/workflows/deploy.yml`
- **Description:** The workflow references environments `staging` and `production` dynamically. These environments must be pre-created in each app repo, and any protection rules must be configured manually. The spec does not mention this.
- **Impact:** PR deployments may fail or bypass protection rules that the operator expected.
- **Suggestion:** Either remove the `environment` block from the template (simplest for v1) or document that repo admins must create and protect the environments. If environments are kept, consider a single `production` environment with branch protection rules.

### Issue 16: `purge_protection_enabled = false` and `soft_delete_retention_days = 7` are risky for production
- **Severity:** Minor (Security / Operational)
- **Location:** Guide `main.tf` (`azurerm_key_vault.main`)
- **Description:** The guide disables Key Vault purge protection. For a production platform, this is dangerous because a compromised or mistaken `terraform destroy` can permanently delete secrets.
- **Impact:** Irreversible secret loss; compliance issues.
- **Suggestion:** Enable `purge_protection_enabled = true` and set `soft_delete_retention_days` to the maximum (90 days) for any non-dev deployment. Make these variables with safe defaults.

### Issue 17: No handling for private GitHub repos during preflight clone
- **Severity:** Minor (Completeness)
- **Location:** Spec §3.4 (preflight)
- **Description:** The preflight validator clones the repo but does not specify how authentication is handled for private repositories. The GHR org may use private repos.
- **Impact:** Preflight fails on private repos or requires manual SSH/GH CLI setup.
- **Suggestion:** Use `gh repo clone` or a shallow HTTPS clone with a token; document the required credentials and scopes.

### Issue 18: No plan for global name uniqueness
- **Severity:** Minor (Completeness)
- **Location:** Spec §3.2 (wrapper CLI)
- **Description:** Azure app service names must be globally unique. The spec proposes a naming convention `ghr-<app>-<env>` but does not describe how collisions are detected or resolved.
- **Impact:** `terraform apply` fails late in the process after other resources may have been created.
- **Suggestion:** Add a preflight step that checks global name availability via Azure API or a deterministic naming strategy with a short hash suffix. Reserve the name before apply if possible.

### Issue 19: No explicit rollback procedure for app-level failures
- **Severity:** Minor (Completeness)
- **Location:** Spec §7 (Rollback)
- **Description:** The spec says "`terraform destroy -target` per app state" and "delete slot" but does not specify the exact command, who runs it, or how to recover state if Terraform fails mid-apply.
- **Impact:** Unclear incident response; operators may delete the wrong resources.
- **Suggestion:** Add a runbook section with exact commands, required permissions, and a "do not use this on shared resources" warning. Consider a wrapper subcommand `deploy.sh destroy <app>`.

### Issue 20: `azure/webapps-deploy@v3` slot-name logic does not handle the case of a dedicated staging app
- **Severity:** Minor (Correctness)
- **Location:** Spec §3.6 and Guide `deploy.yml`
- **Description:** If the decision in R3 is to use per-app B1 staging apps instead of slots, the `deploy.yml` template must deploy to a separate app name, not a slot. The current template assumes slots.
- **Impact:** Inconsistent deployment logic if the cheaper staging-app option is chosen.
- **Suggestion:** Decide the staging strategy in Phase 1 and produce one template, not two.

---

## 6. Unrealistic or Misleading Claims

### Accuracy estimate 85–95% for in-contract simple apps
- **Location:** Spec §6
- **Assessment:** Optimistic for a first version. The benchmark app (Touchpoint) itself has a database and a non-trivial build (Drizzle + Vite). Even after the first app is working, each new runtime or framework introduces new failure modes (Python startup command, Node build output directory, port binding, etc.). A more honest v1 target is **60–80% first-attempt success**, with the 85–95% range as a Phase 2/3 goal after several iterations.

### "The script never silently half-deploys something broken"
- **Location:** Spec §6
- **Assessment:** Terraform can partially apply and then fail, leaving resources in a mixed state. Azure APIs can also return success while the app is misconfigured. The smoke test catches some issues but not all (e.g., broken internal API routes, missing DB migrations). This claim should be softened to "the design aims to fail fast and surface errors; runtime validation reduces the chance of silent failures."

### "Human touch is the productized-service differentiator"
- **Location:** Spec §5 and §1
- **Assessment:** This is a business positioning claim, not a technical specification. It is fine as intent, but the spec should not rely on it to justify unimplemented operational procedures (e.g., triage runbook, failure feedback loop). The differentiator must be backed by concrete workflow steps.

### Phase 1 timeline "this week"
- **Location:** Spec §8
- **Assessment:** Given the provider version bump (3.75 to 4.x), the untested guide, the required SKU decision, the App Insights gap, and the need to deploy a real database-backed app, "this week" is aggressive. A more realistic Phase 1 is two to three weeks, including time to fix the blueprint bugs discovered during the Touchpoint benchmark.

---

## 7. What the Spec Does Well

- **Honest about constraints:** It explicitly excludes databases, custom domains, monorepos, and self-service triggers from v1.
- **Correctly identifies the provider version risk:** R2 (azurerm ~> 3.75 outdated) is accurate and important.
- **Good checkpoint design:** The four human checkpoints (preflight gate, secrets injection, post-deploy eyeball, triage) are a sensible service model.
- **Blast-radius isolation:** One state key per app is a good operational choice.
- **OIDC-first approach:** Avoiding long-lived SP secrets is the right security baseline.

---

## 8. Recommendations Summary

Before implementation begins, the spec should be updated to address at least the following:

1. **Fix the SKU default:** Make S1 the default and validate that slots are not created on B1/Shared plans. Re-word "shared plan" to "shared S1 plan."
2. **Fix the template:** Correct the `slot-name` logic in `deploy.yml` and pin all actions to commit SHAs.
3. **Lock down Key Vault:** Remove broad access policies; use Azure RBAC with least-privilege scopes. Enable purge protection.
4. **Add state locking:** Configure Azure Storage table locking for remote state.
5. **Add App Insights:** Implement the module resource or remove the 100% claim.
6. **Remove auto-approve:** Add an approval gate or rely only on the manual wrapper script for v1 applies.
7. **Define the contract schema:** Add JSON Schema and version field to `azure-deploy.json`.
8. **Soften accuracy claims:** Replace 100% and 85–95% with ranges and conditions.
9. **Address OIDC subject format:** Evaluate the new GitHub immutable default claims and design trust policy accordingly.
10. **Extend the benchmark plan:** Add a list of expected manual nudges for Touchpoint and define what "success" means for the benchmark.

---

## 9. Overall Verdict

The spec is a thoughtful first draft with the right scope boundaries and a sensible human/automation split. However, it overestimates the maturity of the existing blueprint and the accuracy of the first version. Several inherited bugs (B1 + slots, `slot-name: production`, broad Key Vault access) will block the Phase 1 benchmark if not fixed before implementation. The security posture needs significant hardening before any real app is deployed.

**Recommendation:** Revise the spec to address Critical and Major issues before writing code. The Touchpoint benchmark should be treated as a discovery exercise, not a proof-of-success, until the blueprint bugs are resolved.

---

*Sources consulted:* Terraform AzureRM provider docs for `azurerm_linux_web_app`, `azurerm_linux_web_app_slot`, and `azurerm_app_service_source_control` (raw from GitHub main branch); GitHub Docs on OpenID Connect with Azure (2026-07-17); Azure App Service provider documentation knowledge base for SKU and Key Vault reference behavior.
