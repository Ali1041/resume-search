locals {
  name_prefix = var.project_name
}

resource "azurerm_resource_group" "platform" {
  name     = "rg-${local.name_prefix}-platform"
  location = var.location
  tags     = var.tags
}

# One shared Linux App Service Plan hosts every GHR app.
# "Shared" here means one plan shared by many apps — NOT the Azure Shared (D1)
# tier, which has no slots, no always-on, and no TLS custom domains.
resource "azurerm_service_plan" "shared" {
  name                = "asp-${local.name_prefix}-shared"
  resource_group_name = azurerm_resource_group.platform.name
  location            = azurerm_resource_group.platform.location
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = var.tags
}
