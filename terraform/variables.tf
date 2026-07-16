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
  description = "Worker VM size. B2s (2 vCPU / 4 GiB, burstable) is the cheapest size that runs the full HiveBox stack, and fits student-subscription quotas."
  type        = string
  default     = "Standard_B2s"
}
