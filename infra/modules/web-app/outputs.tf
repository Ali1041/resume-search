output "production_url" {
  description = "HTTPS URL of the production web app."
  value       = "https://${azurerm_linux_web_app.this.default_hostname}"
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
  description = "Name of this app's Key Vault."
  value       = azurerm_key_vault.this.name
}

output "key_vault_uri" {
  description = "URI of this app's Key Vault (used in Key Vault references)."
  value       = azurerm_key_vault.this.vault_uri
}

output "app_principal_id" {
  description = "Object ID of the production web app's system-assigned identity."
  value       = azurerm_linux_web_app.this.identity[0].principal_id
}

output "web_app_name" {
  description = "Name of the production web app."
  value       = azurerm_linux_web_app.this.name
}

output "staging_web_app_name" {
  description = "Name of the staging web app (staging_mode = \"app\") or null in slot mode."
  value       = local.create_staging_app ? azurerm_linux_web_app.staging[0].name : null
}
