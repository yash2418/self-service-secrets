# infra/arc

Configures GitHub's Actions Runner Controller (ARC) inside the EKS cluster so
`.github/workflows/secret-update.yml` can reach the cluster directly (kubectl)
without exposing the API server publicly. `secret-create.yml` doesn't use any
of this - it runs on `ubuntu-latest` since it never touches the cluster.

All commands below assume repo root as the working directory unless noted.

## 1. Install the ARC controller

One-time, cluster-wide (not tied to any one env/service):

```
helm install arc \
  --namespace arc-systems --create-namespace \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller
```

## 2. Create the namespaces

```
kubectl create namespace runners-dev
# sample-api-service-dev already exists via Argo CD's CreateNamespace=true
```

Prod is not set up yet - only the Dev runner pool is configured for now.

## 3. Create the runner registration secret

ARC needs a GitHub App installation token or a repo-scoped PAT to register
runners against your repo. Use a fine-grained PAT with `Administration:
write` on the target repo, or a GitHub App (preferred for anything beyond a
quick test - see the [ARC quickstart](https://github.com/actions/actions-runner-controller/blob/master/docs/preview/gha-runner-scale-set-controller/README.md)).

```
kubectl create secret generic gha-runner-github-secret -n runners-dev \
  --from-literal=github_token=<PAT_OR_APP_TOKEN>
```

## 4. Set up IRSA for the Dev runner pool

Same `--role-only` pattern as `infra/README.md` step 4 - this ServiceAccount
is declared in git (`arc/runners/dev-serviceaccount.yaml`), so don't let
eksctl touch the k8s object directly.

```
# Scoped to dev/* secrets (see infra/eks/iam-policy-secrets-read.json)
aws iam create-policy --policy-name sample-api-service-dev-secrets-read \
  --policy-document file://infra/eks/iam-policy-secrets-read.json

eksctl create iamserviceaccount \
  --cluster sample-api-service-dev --region us-east-1 \
  --namespace runners-dev --name secret-ops-dev-runner \
  --attach-policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/sample-api-service-dev-secrets-read \
  --role-only --role-name secret-ops-dev-runner-irsa --approve

aws iam get-role --role-name secret-ops-dev-runner-irsa --query Role.Arn --output text
# -> paste into infra/arc/runners/dev-serviceaccount.yaml, replacing <IRSA_ROLE_ARN_DEV>
```

## 5. Fill in the remaining placeholders

- `infra/arc/runners/values-dev.yaml`: replace `githubConfigUrl` with your
  real `https://github.com/<org>/<repo>`.
- Same `<org>/<repo>` doesn't appear elsewhere, but `<ACCOUNT_ID>` also shows
  up in `.github/workflows/secret-create.yml`'s `role-to-assume` - that's a
  separate OIDC role for the AWS-only flow, unrelated to IRSA above.
- The runner pod needs a custom image bundling git/yq/jq/aws-cli/kubectl
  (built from `infra/arc/runners/Dockerfile`) - build and push it, then
  replace `<ECR_REPO>` in `values-dev.yaml`'s `template.spec.containers[0].image`:
  ```
  docker build -t <ECR_REPO>/arc-runner-tools:latest infra/arc/runners
  docker push <ECR_REPO>/arc-runner-tools:latest
  ```

## 6. Apply everything

The scale set itself is a Helm release, not a plain manifest -
`gha-runner-scale-set-controller` stamps a version label on it that only
`helm install`/`helm template` of the matching chart version can produce; a
hand-authored `AutoscalingRunnerSet` applied via `kubectl apply -f` gets
silently deleted by the controller on its next reconcile. See the comment
block in `values-dev.yaml` for why.

```
kubectl apply -f infra/arc/runners/dev-serviceaccount.yaml
kubectl apply -f infra/arc/rbac/dev-rolebinding.yaml

helm upgrade --install dev-runners \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set \
  --version 0.14.2 \
  --namespace runners-dev \
  -f infra/arc/runners/values-dev.yaml
```

`--version` must match the installed controller's build version - check with:
```
kubectl get deploy -n arc-systems arc-gha-rs-controller \
  -o jsonpath='{.metadata.labels.app\.kubernetes\.io/version}'
```

Verify runners registered:

```
kubectl get pods -n runners-dev
```
They should also show up under the repo's **Settings -> Actions -> Runners**
tab in GitHub, labeled `dev-runners`.

## 7. Configure GitHub Environments

`.github/workflows/secret-update.yml` gates jobs with `environment:
${{ inputs.environment }}`. In **Settings -> Environments**, create one
Environment per enum value used in the workflow's `environment` choice input
(just `Dev` right now - name must match exactly, case-sensitive). Add more
Environments (and required reviewers on `Prod`) as they're wired up in the
workflow.

## 8. Test it

Trigger `secret-update` via **Actions -> secret-update -> Run workflow**
with `service: Sample_Api_Service`, `environment: Dev`,
`namespace: sample-api-service-dev`, and a real `env-var-name`/`new-value`.
Watch the job land on a pod in `runners-dev`:

```
kubectl get pods -n runners-dev -w
```

`secret-create` needs no cluster setup - just the `id-token: write`
permission (already in the workflow) and the OIDC trust relationship on the
`gha-secret-ops` IAM role referenced in its `role-to-assume`.
