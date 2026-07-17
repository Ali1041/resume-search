output "production_url" {
  description = "HTTPS URL of the production web app."
  value       = module.web_app.production_url
}

output "staging_url" {
  description = "HTTPS URL of the staging environment for the active staging_mode."
  value       = module.web_app.staging_url
}

output "key_vault_name" {
  description = "Per-app Key Vault name."
  value       = module.web_app.key_vault_name
}

output "key_vault_uri" {
  description = "Per-app Key Vault URI."
  value       = module.web_app.key_vault_uri
}
