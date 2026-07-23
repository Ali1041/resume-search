variable "app_name" {
  description = "Globally unique name for the web app (lowercase alnum + hyphens). Becomes https://<app_name>.azurewebsites.net. Capped at 52 chars so the '-staging' suffix stays within the 60-char web app limit."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,50}[a-z0-9]$", var.app_name))
    error_message = "app_name must be 3-52 chars of lowercase letters, digits, and hyphens, starting and ending with a letter or digit (52 max so '<name>-staging' fits the 60-char Azure limit)."
  }
}

variable "resource_group_name" {
  description = "Resource group hosting the app (usually the platform RG)."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "app_service_plan_id" {
  description = "Resource ID of the shared App Service Plan (from the platform root outputs)."
  type        = string
}

variable "runtime" {
  description = "Application runtime."
  type        = string

  validation {
    condition     = contains(["node", "python"], var.runtime)
    error_message = "runtime must be \"node\" or \"python\"."
  }
}

variable "create_production" {
  description = "Whether to create the production web app. Set false for staging-only deployments of an app whose production already exists elsewhere. Requires staging_mode = \"app\" — a slot cannot exist without its parent app."
  type        = bool
  default     = true

  validation {
    condition     = var.create_production || var.staging_mode == "app"
    error_message = "create_production=false requires staging_mode = \"app\": a staging slot lives ON the production app, so a staging-only deployment must use a separate staging app. Create ONLY what was requested."
  }
}

variable "runtime_version" {
  description = "Runtime version. Empty string selects the default for the runtime (node: 20-lts, python: 3.11)."
  type        = string
  default     = ""
}

variable "staging_mode" {
  description = "'slot' = azurerm_linux_web_app_slot named 'staging' (requires S1+ plan); 'app' = second web app named <app_name>-staging on the same plan (works on Basic)."
  type        = string
  default     = "slot"

  validation {
    condition     = contains(["slot", "app"], var.staging_mode)
    error_message = "staging_mode must be \"slot\" or \"app\"."
  }
}

variable "app_settings" {
  description = "Non-secret app settings from the azure-deploy.json contract."
  type        = map(string)
  default     = {}
}

variable "kv_secret_references" {
  description = "Map of APP_SETTING_NAME => Key Vault secret name. Rendered as Key Vault references into app settings. Secrets themselves are created by humans (az keyvault secret set), never by Terraform."
  type        = map(string)
  default     = {}
}

variable "kv_purge_protection_enabled" {
  description = "Enable purge protection on the per-app Key Vault. Keep true outside throwaway dev environments."
  type        = bool
  default     = true
}

variable "operator_object_id" {
  description = "Object ID of the human operator (AAD user/group) who may set secrets. Gets Key Vault Secrets Officer on this app's vault. Empty string skips the assignment."
  type        = string
  default     = ""
}

variable "deploy_sp_object_id" {
  description = "Object ID of the GitHub Actions deployment service principal. Gets Website Contributor on the web app(s). Empty string skips the assignment."
  type        = string
  default     = ""
}

variable "health_check_path" {
  description = "Path Azure pings for health checks. Should match the contract's health_check_path."
  type        = string
  default     = "/health"

  validation {
    condition     = can(regex("^/", var.health_check_path))
    error_message = "health_check_path must start with /."
  }
}

variable "startup_command" {
  description = "Startup command (site_config.app_command_line). Empty string = platform default."
  type        = string
  default     = ""
}

variable "enable_app_insights" {
  description = "Create a Log Analytics workspace + Application Insights and wire APPLICATIONINSIGHTS_CONNECTION_STRING into app settings."
  type        = bool
  default     = true
}

variable "slot_sticky_setting_names" {
  description = "App setting names that must NOT swap between slots (e.g. slot-specific Key Vault references). Only used when staging_mode = \"slot\"."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to all resources created by this module."
  type        = map(string)
  default     = {}
}
