variable "app_name" {
  description = "Globally unique web app name (lowercase alnum + hyphens)."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group hosting the app (platform RG from platform root outputs)."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "canadacentral"
}

variable "app_service_plan_id" {
  description = "Resource ID of the shared App Service Plan (platform root output)."
  type        = string
}

variable "runtime" {
  description = "node or python."
  type        = string

  validation {
    condition     = contains(["node", "python"], var.runtime)
    error_message = "runtime must be \"node\" or \"python\"."
  }
}

variable "runtime_version" {
  description = "Runtime version; empty string = module default (node 20-lts / python 3.11)."
  type        = string
  default     = ""
}

variable "staging_mode" {
  description = "slot = staging deployment slot (S1+ plan); app = separate <app>-staging web app."
  type        = string
  default     = "slot"

  validation {
    condition     = contains(["slot", "app"], var.staging_mode)
    error_message = "staging_mode must be \"slot\" or \"app\"."
  }
}

variable "create_production" {
  description = "Create the production web app. false = staging-only deployment (requires staging_mode \"app\")."
  type        = bool
  default     = true
}

variable "startup_command" {
  description = "Startup command; empty string = platform default."
  type        = string
  default     = ""
}

variable "health_check_path" {
  description = "Health check path."
  type        = string
  default     = "/health"
}

variable "app_settings" {
  description = "Non-secret app settings from the contract."
  type        = map(string)
  default     = {}
}

variable "kv_secret_references" {
  description = "Map of APP_SETTING_NAME => Key Vault secret name (contract kv_secrets)."
  type        = map(string)
  default     = {}
}

variable "slot_sticky_setting_names" {
  description = "App setting names that must not move during a slot swap (slot mode only)."
  type        = list(string)
  default     = []
}

variable "operator_object_id" {
  description = "AAD object ID of the human operator (Key Vault Secrets Officer). Empty = skip."
  type        = string
  default     = ""
}

variable "deploy_sp_object_id" {
  description = "AAD object ID of the GitHub Actions SP (Website Contributor). Empty = skip."
  type        = string
  default     = ""
}

variable "enable_app_insights" {
  description = "Create Log Analytics + Application Insights for this app."
  type        = bool
  default     = true
}

variable "kv_purge_protection_enabled" {
  description = "Purge protection on the per-app Key Vault."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Resource tags."
  type        = map(string)
  default     = {}
}
