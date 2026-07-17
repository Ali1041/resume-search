terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Partial configuration. Pass the remaining settings at init time, e.g.:
  #   terraform init -backend-config=backend.hcl
  # or:
  #   terraform init \
  #     -backend-config="resource_group_name=<rg>" \
  #     -backend-config="storage_account_name=<sa>" \
  #     -backend-config="container_name=tfstate" \
  #     -backend-config="key=platform.tfstate" \
  #     -backend-config="use_oidc=true"
  # Never hardcode the storage account here.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
}
