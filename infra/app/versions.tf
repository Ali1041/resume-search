terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Partial configuration. The state key is per-app and is passed by deploy.sh:
  #   terraform init -backend-config="key=apps/<app_name>.tfstate" \
  #                  -backend-config=backend.hcl
  # (resource_group_name / storage_account_name / container_name / use_oidc come
  # from the same backend.hcl as the platform root, or from -backend-config flags.)
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      # Keep purge protection meaningful: recovering a soft-deleted vault is a
      # deliberate human action (az keyvault recover), not a Terraform default.
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
}
