output "production_url" {
  description = "HTTPS URL of the production web app, or null for staging-only deployments (create_production = false)."
  value       = try("https://${azurerm_linux_web_app.this[0].default_hostname}", null)
}

output "staging_url" {
  description = "HTTPS URL of the staging environment (slot or separate app, depending on staging_mode)."
  value = (
    var.staging_mode == "slot"
    ? "https://${azurerm_linux_web_app_slot.staging[0].default_hostname}"
    : "https://${azurerm_linux_web_app.staging[0].default_hostname}"
  )
}

output "key_vault_name" {
  description = "Name of this app's Key Vault, or null when the contract declares no kv_secrets (plain env-var mode)."
  value       = try(azurerm_key_vault.this[0].name, null)
}

output "key_vault_uri" {
  description = "URI of this app's Key Vault (used in Key Vault references), or null in env-var mode."
  value       = try(azurerm_key_vault.this[0].vault_uri, null)
}

output "app_principal_id" {
  description = "Object ID of the production web app's system-assigned identity, or null when no production app exists."
  value       = try(azurerm_linux_web_app.this[0].identity[0].principal_id, null)
}

output "web_app_name" {
  description = "Name of the production web app, or null when create_production = false."
  value       = try(azurerm_linux_web_app.this[0].name, null)
}

output "staging_web_app_name" {
  description = "Name of the staging web app (staging_mode = \"app\") or null in slot mode."
  value       = local.create_staging_app ? azurerm_linux_web_app.staging[0].name : null
}
