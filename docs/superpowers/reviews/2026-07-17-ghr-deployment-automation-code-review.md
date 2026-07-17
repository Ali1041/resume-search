# GHR deploy automation — apply-time review (azurerm 4.81)

**Scope:** `infra/modules/web-app/main.tf`, `infra/modules/web-app/outputs.tf`, `infra/app/main.tf`, `infra/platform/main.tf` on `feature/ghr-deploy-automation`.
**Excluded:** webdeploy basic auth, sticky_settings, JSON tfvars, SKU guard.

## Findings

### 1. Key Vault name is not sanitized for Azure rules (HIGH)
**File:** `infra/modules/web-app/main.tf:8-9`

`local.kv_name = "kv-${substr(var.app_name, 0, 16)}-${local.kv_suffix}"` copies characters from `var.app_name` without lowercasing or stripping non-alphanumeric/hyphen characters. Key Vault names must be 3–24 lowercase alphanumeric characters or hyphens and start with a letter. If `app_name` contains uppercase, underscores, or other characters, `terraform apply` fails with an invalid name error.

**Fix:** Sanitize with `lower(regex_replace(var.app_name, "[^a-z0-9-]", ""))` before truncating.

### 2. Staging app name can exceed 60-character limit (HIGH)
**File:** `infra/modules/web-app/main.tf:211`

`azurerm_linux_web_app.staging` name is `"${var.app_name}-staging"`. Linux web app names must be ≤60 characters. If `var.app_name` is 60 characters, the staging name becomes 68 characters and `terraform apply` fails.

**Fix:** Validate `app_name` length so that `${app_name}-staging` fits, or truncate the base name before appending the suffix.

### 3. Key Vault name uniqueness is too weak (MEDIUM)
**File:** `infra/modules/web-app/main.tf:8-9`

The 4-character hex suffix produces only 65,536 possible values and is derived solely from `var.app_name`. Key Vault names are globally unique across Azure. Two deployments with the same `app_name` (e.g., different projects or environments) will collide. A shared 16-character prefix plus a hash collision can also produce the same name.

**Fix:** Include project/environment or subscription identifier in the suffix, or add a `random_string` with `keepers` tied to `var.app_name`.

### 4. Production App Insights connection string reused for staging (MEDIUM)
**File:** `infra/modules/web-app/main.tf:25-28`, `199`, `237`

Both the staging slot and the separate staging app use `local.merged_app_settings`, which includes the production `APPLICATIONINSIGHTS_CONNECTION_STRING`. This is slot/staging-app config drift: staging telemetry will be reported to the production App Insights resource, making it impossible to isolate staging metrics.

**Fix:** Create a staging App Insights instance and pass its connection string to the staging slot/app.

### 5. Missing explicit depends_on for system-assigned identity role assignments (LOW)
**File:** `infra/modules/web-app/main.tf:52-72`, `85-99`

Role assignments on `azurerm_linux_web_app.this`, `azurerm_linux_web_app.staging`, and `azurerm_linux_web_app_slot.staging` system-assigned identities rely only on the implicit dependency from `identity[0].principal_id`. In Azure, the service principal can take seconds to propagate after the app/slot is created, causing intermittent `PrincipalNotFound` errors during `terraform apply`.

**Fix:** Add `depends_on = [azurerm_linux_web_app.this]` (or the staging/slot resource) to each role assignment to increase the chance that the identity is ready.

### 6. Web app name constraints not validated (LOW)
**File:** `infra/modules/web-app/main.tf:128`, `211`

`var.app_name` is used directly for the production app and as the prefix for the staging app. Linux web app names must be 2–60 characters, alphanumeric/hyphen, globally unique, and cannot start or end with a hyphen. No validation or sanitization is applied in the module. Invalid values will fail at apply time.

**Fix:** Add `validation` blocks on the `app_name` variable and/or sanitize the name in the module.

## Not found
- No incorrect azurerm 4.x attribute names were identified in the reviewed files.
- No role assignment scope errors were identified.
