# self-service-secrets

Self-service secrets management for a Kubernetes-deployed service: GitHub
Actions workflows backed by AWS Secrets Manager, the Secrets Store CSI
Driver, and Argo CD.

## Contents

| Path | What |
|---|---|
| `.github/workflows/` | `secret-create.yml`, `secret-update.yml` |
| `Kustomize/Services/<Service>/` | Per-service Base + per-environment Overlays (Deployment, SecretProviderClass, ServiceAccount) |
| `apps/` | Application source (`sample-api-service`) |
| `argocd-apps/` | Argo CD `Application` manifests |
| `infra/eks/` | EKS cluster definition, IAM policies |
| `infra/arc/` | Actions Runner Controller: runner scale set, RBAC, custom runner image |

## Setup

- [`infra/README.md`](infra/README.md)
- [`infra/arc/README.md`](infra/arc/README.md)
