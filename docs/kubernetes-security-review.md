# Kubernetes Security Review

A review of this project's posture against common Kubernetes hardening
guidance (Kubernetes docs security checklist, NSA/CISA Kubernetes Hardening
Guide, CIS benchmark themes). Last updated for the helm/kustomize packaging
phase.

## What we implement

| Practice | Where |
|---|---|
| Non-root containers, enforced (`runAsNonRoot` + `runAsUser`) | app, valkey (uid 10001), minio |
| No privilege escalation (`allowPrivilegeEscalation: false`) | all workloads |
| Read-only root filesystem (writable paths are explicit volumes) | all workloads |
| All Linux capabilities dropped | all workloads |
| Default seccomp profile (`RuntimeDefault`) | all pods |
| No service-account token automount — pods hold no cluster credential | all pods |
| Resource requests and limits (DoS blast-radius containment) | all workloads |
| Readiness/liveness probes on every workload | all workloads |
| Non-root image (`USER node`), no shell wrapper for PID 1 | Dockerfile |
| Supply chain: all CI actions pinned to commit SHAs | workflows |
| Static analysis in CI: Semgrep (code) + Terrascan (rendered manifests) | main.yml |
| Least-privilege CI token (`permissions:` allowlist) | cd.yml |

## Accepted trade-offs (documented skips)

| Rule | Trade-off |
|---|---|
| AC_K8S_0069 / 0068 (image digest, `:latest`) | Local image is side-loaded via `kind load`; no registry digest exists. Fixed when the deployment pulls from GHCR. |
| AC_K8S_0002 (ingress TLS) | `http://localhost` on a local cluster has no certificate. A real deployment adds a `tls:` block + cert-manager. |
| AC_K8S_0073 (AppArmor) | Docker Desktop's kernel has no AppArmor; kubelet rejects pods requesting unenforceable profiles (verified live). Re-add on AppArmor-capable nodes. |
| AC_K8S_0051 (secrets as env vars) | The app is 12-factor and reads env vars. Env secrets can leak via /proc or crash dumps; file-mounted secrets are the stricter pattern and require an app change. Revisit if handling real credentials. |

## Known gaps, prioritised

1. **Secrets management** — local MinIO credentials live in a kustomize
   `secretGenerator` in the repo (defaults, local-only). Real deployments
   need External Secrets Operator or Sealed Secrets; nothing sensitive may
   be committed.
2. **NetworkPolicies** — no traffic restrictions between pods; a compromised
   pod can reach Valkey, MinIO, and the internet freely. Caveat: KIND's
   default CNI (kindnet) does not enforce NetworkPolicies — testing them
   locally requires installing Calico/Cilium (`disableDefaultCNI`).
3. **Namespace isolation** — everything runs in `default`. Separating app
   and infra namespaces enables scoped RBAC and network boundaries.
4. **Pod Security Admission** — the hardening is per-manifest convention;
   labelling namespaces with the `restricted` Pod Security Standard would
   make the cluster reject any future non-compliant pod.
5. **Image provenance** — CD pushes `main-<sha>` tags but the cluster still
   runs a side-loaded local image; pulling by digest from GHCR (and later,
   signing with cosign) closes the gap.
6. **RBAC review** — default service accounts are unused (automount off) but
   no explicit RBAC has been authored; becomes relevant with GitOps.

## Threat-model summary

An attacker who achieves code execution in the app container today gets:
a non-root process with no capabilities, a read-only filesystem, no
service-account token, seccomp-filtered syscalls, and bounded CPU/memory.
Primary remaining lateral movement: unrestricted pod-to-pod networking
(gap 2) and env-visible MinIO credentials scoped to local dev (gap 1).
