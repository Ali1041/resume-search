variable "project_name" {
  description = "Short project prefix used in resource names."
  type        = string
  default     = "ghr"

  validation {
    condition     = can(regex("^[a-z0-9-]{2,12}$", var.project_name))
    error_message = "project_name must be 2-12 chars of lowercase letters, digits, and hyphens."
  }
}

variable "location" {
  description = "Azure region for all platform resources."
  type        = string
  default     = "canadacentral"
}

variable "app_service_sku" {
  description = "SKU for the shared Linux App Service Plan (e.g. S1, P1v3, B1)."
  type        = string
  default     = "S1"
}

variable "staging_mode" {
  description = "How staging environments are realised: 'slot' = deployment slot on each app (requires a slot-capable SKU), 'app' = a separate <app>-staging web app on the same plan (works on Basic)."
  type        = string
  default     = "slot"

  validation {
    condition     = contains(["slot", "app"], var.staging_mode)
    error_message = "staging_mode must be \"slot\" or \"app\"."
  }

  # Deployment slots are not available on Free (F1), Shared (D1), or Basic (B*) tiers.
  # Choosing staging_mode = "slot" with one of those SKUs would fail at apply time
  # deep inside every per-app deployment, so reject it here at the platform level.
  validation {
    condition     = var.staging_mode != "slot" || !contains(["F1", "D1", "B1", "B2", "B3"], upper(var.app_service_sku))
    error_message = "staging_mode \"slot\" requires a Standard or Premium SKU (S1+). ${var.app_service_sku} does not support deployment slots. Either raise app_service_sku to S1+ or set staging_mode = \"app\"."
  }
}

variable "tags" {
  description = "Tags applied to all platform resources."
  type        = map(string)
  default = {
    managed-by = "terraform"
    project    = "ghr-platform"
  }
}
