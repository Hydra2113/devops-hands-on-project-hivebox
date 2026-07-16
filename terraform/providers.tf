terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # State is local for this learning setup and MUST stay out of git — it
  # contains cluster credentials (see .gitignore). A team setup would use a
  # remote backend (azurerm blob) with locking.
}

provider "azurerm" {
  features {}
  # Auth comes from the Azure CLI session (`az login`) — no secrets here.

  # Student subscriptions refuse registration of some providers in the
  # default blanket set; the few AKS needs are registered explicitly
  # (az provider register) instead.
  resource_provider_registrations = "none"
}
