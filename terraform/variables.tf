variable "location" {
  description = "Azure region. australiaeast (Sydney) is the closest major region to Auckland."
  type        = string
  default     = "australiaeast"
}

variable "node_count" {
  description = "Worker nodes in the default pool."
  type        = number
  default     = 1
}

variable "node_vm_size" {
  description = "Worker VM size. B2als_v2 (2 vCPU / 4 GiB, burstable AMD) is the cheapest size that runs the full HiveBox stack; v1 B-series (B2s) is not allowed on student subscriptions in australiaeast."
  type        = string
  default     = "Standard_B2als_v2"
}
