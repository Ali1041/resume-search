data "azurerm_client_config" "current" {}

locals {
  # Names are sanitized in-module (defense in depth — deploy.sh sanitizes too).
  clean_app_name = lower(replace(var.app_name, "/[^a-z0-9-]/", "-"))

  # Key Vault names: 3-24 chars, lowercase alnum + hyphen, must start with a letter.
  # "kv-" (3) + up to 12 chars of app name + "-" + 8-char hash = max 24.
  # The hash covers app name + resource group + subscription so vault names stay
  # globally unique across projects and environments (code review findings 1 & 3).
  kv_suffix = substr(sha256("${var.app_name}/${var.resource_group_name}/${data.azurerm_client_config.current.subscription_id}"), 0, 8)
  kv_name   = "kv-${substr(local.clean_app_name, 0, 12)}-${local.kv_suffix}"

  # app_name is validated to <= 52 chars, so "${name}-staging" always fits the
  # 60-char web app limit (code review finding 2).
  staging_app_name = "${local.clean_app_name}-staging"

  effective_runtime_version = var.runtime_version != "" ? var.runtime_version : (var.runtime == "node" ? "20-lts" : "3.11")

  create_slot        = var.staging_mode == "slot"
  create_staging_app = var.staging_mode == "app"
  create_staging     = local.create_slot || local.create_staging_app

  # Build strategy (review R5): Oryx remote build via SCM_DO_BUILD_DURING_DEPLOYMENT.
  # WEBSITE_RUN_FROM_PACKAGE is intentionally NOT set — pick one strategy, not both.
  kv_reference_settings = {
    for setting_name, secret_name in var.kv_secret_references :
    setting_name => "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.this.vault_uri}secrets/${secret_name})"
  }

  merged_app_settings = merge(
    var.app_settings,
    { SCM_DO_BUILD_DURING_DEPLOYMENT = "true" },
    var.enable_app_insights ? { APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.this[0].connection_string } : {},
    local.kv_reference_settings
  )

  # Staging gets its OWN App Insights instance (code review finding 4) so staging
  # telemetry never pollutes production dashboards/alerts.
  staging_app_settings = merge(
    var.app_settings,
    { SCM_DO_BUILD_DURING_DEPLOYMENT = "true" },
    var.enable_app_insights && local.create_staging ? { APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.staging[0].connection_string } : {},
    local.kv_reference_settings
  )
}

# -----------------------------------------------------------------------------
# Per-app Key Vault (review issues 1 & 6: no shared vault, no access policies —
# Azure RBAC only, least privilege, per-app blast radius).
# Terraform never creates secrets. Humans set them:
#   az keyvault secret set --vault-name <kv> --name <secret> --value <value>
# -----------------------------------------------------------------------------
resource "azurerm_key_vault" "this" {
  name                       = local.kv_name
  location                   = var.location
  resource_group_name        = var.resource_group_name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true

  soft_delete_retention_days = 90
  purge_protection_enabled   = var.kv_purge_protection_enabled

  tags = var.tags
}

# Production web app identity can read ONLY this app's vault.
resource "azurerm_role_assignment" "app_kv_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.this.identity[0].principal_id

  # Give AAD time to replicate the new principal before assigning (intermittent
  # PrincipalNotFound otherwise — code review finding 5).
  depends_on = [azurerm_linux_web_app.this]
}

# The staging slot has its own system-assigned identity; it needs the same read
# access because slot app_settings contain the same Key Vault references.
resource "azurerm_role_assignment" "slot_kv_secrets_user" {
  count                = local.create_slot ? 1 : 0
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app_slot.staging[0].identity[0].principal_id

  depends_on = [azurerm_linux_web_app_slot.staging]
}

resource "azurerm_role_assignment" "staging_app_kv_secrets_user" {
  count                = local.create_staging_app ? 1 : 0
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.staging[0].identity[0].principal_id

  depends_on = [azurerm_linux_web_app.staging]
}

# Human operator manages secrets (set/list/delete) on this app's vault only.
resource "azurerm_role_assignment" "operator_kv_secrets_officer" {
  count                = var.operator_object_id != "" ? 1 : 0
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.operator_object_id
}

# GitHub Actions SP can deploy code to the web app but gets NO Key Vault data
# plane access at all (review issue 1). Slots inherit from the parent site
# scope, so one assignment covers the slot in "slot" mode.
resource "azurerm_role_assignment" "deploy_sp_website_contributor" {
  count                = var.deploy_sp_object_id != "" ? 1 : 0
  scope                = azurerm_linux_web_app.this.id
  role_definition_name = "Website Contributor"
  principal_id         = var.deploy_sp_object_id
}

# In "app" staging mode the staging site is a separate resource and needs its
# own assignment.
resource "azurerm_role_assignment" "deploy_sp_website_contributor_staging" {
  count                = var.deploy_sp_object_id != "" && local.create_staging_app ? 1 : 0
  scope                = azurerm_linux_web_app.staging[0].id
  role_definition_name = "Website Contributor"
  principal_id         = var.deploy_sp_object_id
}

# -----------------------------------------------------------------------------
# Observability (review issue 8: App Insights is actually created and wired).
# -----------------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "this" {
  count               = var.enable_app_insights ? 1 : 0
  name                = substr("log-${var.app_name}", 0, 63)
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_application_insights" "this" {
  count               = var.enable_app_insights ? 1 : 0
  name                = "appi-${local.clean_app_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.this[0].id
  tags                = var.tags
}

# Separate App Insights for staging (slot or staging app) — shares the same Log
# Analytics workspace but keeps telemetry isolated from production.
resource "azurerm_application_insights" "staging" {
  count               = var.enable_app_insights && local.create_staging ? 1 : 0
  name                = "appi-${local.clean_app_name}-staging"
  location            = var.location
  resource_group_name = var.resource_group_name
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.this[0].id
  tags                = var.tags
}

# -----------------------------------------------------------------------------
# Production web app.
# -----------------------------------------------------------------------------
resource "azurerm_linux_web_app" "this" {
  name                = local.clean_app_name
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = var.app_service_plan_id

  https_only = true

  # Disable basic auth for FTP/SCM endpoints (azpublisher-style credentials).
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false

  identity {
    type = "SystemAssigned"
  }

  site_config {
    minimum_tls_version               = "1.2"
    always_on                         = true
    health_check_path                 = var.health_check_path
    health_check_eviction_time_in_min = 2
    app_command_line                  = var.startup_command != "" ? var.startup_command : null

    application_stack {
      node_version   = var.runtime == "node" ? local.effective_runtime_version : null
      python_version = var.runtime == "python" ? local.effective_runtime_version : null
    }
  }

  app_settings = local.merged_app_settings

  # Slot-sticky settings (review 2.4): listed names stay with their slot across
  # swaps instead of travelling with the code. Only meaningful in slot mode.
  dynamic "sticky_settings" {
    for_each = local.create_slot && length(var.slot_sticky_setting_names) > 0 ? [var.slot_sticky_setting_names] : []
    content {
      app_setting_names = sticky_settings.value
    }
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Scenario A: staging as a deployment slot named "staging" (requires S1+ plan;
# the platform root validates the SKU). always_on = true (review issue 13).
# -----------------------------------------------------------------------------
resource "azurerm_linux_web_app_slot" "staging" {
  count          = local.create_slot ? 1 : 0
  name           = "staging"
  app_service_id = azurerm_linux_web_app.this.id

  https_only = true

  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false

  identity {
    type = "SystemAssigned"
  }

  site_config {
    minimum_tls_version               = "1.2"
    always_on                         = true
    health_check_path                 = var.health_check_path
    health_check_eviction_time_in_min = 2
    app_command_line                  = var.startup_command != "" ? var.startup_command : null

    application_stack {
      node_version   = var.runtime == "node" ? local.effective_runtime_version : null
      python_version = var.runtime == "python" ? local.effective_runtime_version : null
    }
  }

  app_settings = local.staging_app_settings

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Scenario B: staging as a second web app (<app_name>-staging) on the same plan.
# Works on Basic SKUs (B1) where slots do not exist. No swap capability —
# promotion is a redeploy to the production app.
# -----------------------------------------------------------------------------
resource "azurerm_linux_web_app" "staging" {
  count               = local.create_staging_app ? 1 : 0
  name                = local.staging_app_name
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = var.app_service_plan_id

  https_only = true

  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false

  identity {
    type = "SystemAssigned"
  }

  site_config {
    minimum_tls_version               = "1.2"
    always_on                         = true
    health_check_path                 = var.health_check_path
    health_check_eviction_time_in_min = 2
    app_command_line                  = var.startup_command != "" ? var.startup_command : null

    application_stack {
      node_version   = var.runtime == "node" ? local.effective_runtime_version : null
      python_version = var.runtime == "python" ? local.effective_runtime_version : null
    }
  }

  app_settings = local.staging_app_settings

  tags = var.tags
}
