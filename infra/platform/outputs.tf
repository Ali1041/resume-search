output "app_service_plan_id" {
  description = "Resource ID of the shared App Service Plan. Pass this to every per-app deployment."
  value       = azurerm_service_plan.shared.id
}

output "app_service_plan_name" {
  description = "Name of the shared App Service Plan."
  value       = azurerm_service_plan.shared.name
}

output "resource_group_name" {
  description = "Name of the platform resource group that hosts the shared plan."
  value       = azurerm_resource_group.platform.name
}

output "location" {
  description = "Azure region of the platform resources."
  value       = azurerm_resource_group.platform.location
}

output "staging_mode" {
  description = "Staging strategy this platform was sized for. Echoed for deploy.sh convenience."
  value       = var.staging_mode
}
