resource "azurerm_resource_group" "hivebox" {
  name     = "hivebox-rg"
  location = var.location
}

resource "azurerm_kubernetes_cluster" "hivebox" {
  name                = "hivebox-aks"
  location            = azurerm_resource_group.hivebox.location
  resource_group_name = azurerm_resource_group.hivebox.name
  dns_prefix          = "hivebox"

  # Free control plane (no SLA) — right for learning; nodes are the only cost.
  sku_tier = "Free"

  default_node_pool {
    name       = "default"
    node_count = var.node_count
    vm_size    = var.node_vm_size
  }

  # Managed identity instead of service-principal credentials to rotate.
  identity {
    type = "SystemAssigned"
  }
}

output "resource_group" {
  value = azurerm_resource_group.hivebox.name
}

output "cluster_name" {
  value = azurerm_kubernetes_cluster.hivebox.name
}

output "kubeconfig_command" {
  description = "Run this to point kubectl at the cluster."
  value       = "az aks get-credentials --resource-group ${azurerm_resource_group.hivebox.name} --name ${azurerm_kubernetes_cluster.hivebox.name}"
}
