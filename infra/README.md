# infra/eks

Standalone EKS cluster for testing the Argo CD / Argo Workflows / Secrets Store
CSI flow end-to-end, without touching production.

## 1. Create the cluster

```
eksctl create cluster -f eks/cluster-dev.yaml
```

`eks/cluster-dev.yaml` provisions a minimal cluster with an eksctl-managed VPC
(no `vpc:` block, so eksctl creates one) and OIDC enabled for IRSA. It does
**not** install the Secrets Store CSI Driver, the AWS provider, or any other
add-on beyond eksctl's defaults (vpc-cni, coredns, kube-proxy) - those are
separate steps below.

## 2. Install the Secrets Store CSI Driver

`syncSecret.enabled=true` is required: our SecretProviderClasses use
`secretObjects` to materialize a real k8s Secret (not just the CSI volume
file), which is what services read their env vars from via `secretKeyRef`.

```
helm repo add secrets-store-csi-driver https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts
helm repo update
helm install csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver \
  --namespace kube-system \
  --set syncSecret.enabled=true \
  --set enableSecretRotation=true
```

## 3. Install the AWS provider (ASCP)

```
kubectl apply -f https://raw.githubusercontent.com/aws/secrets-store-csi-driver-provider-aws/main/deployment/aws-provider-installer.yaml
```

## 4. Set up IRSA for a service's ServiceAccount

Example for `sample-api-service` in the `sample-api-service-dev` namespace.
Use `--role-only` - the ServiceAccount object itself is owned by Argo CD
(`selfHeal: true`), so letting eksctl create/patch it directly would just get
reverted on the next sync.

```
aws iam create-policy \
  --policy-name sample-api-service-dev-secrets-read \
  --policy-document file://eks/iam-policy-secrets-read.json

eksctl create iamserviceaccount \
  --cluster sample-api-service-dev \
  --region ap-south-1 \
  --namespace sample-api-service-dev \
  --name sample-api-service \
  --attach-policy-arn arn:aws:iam::951734991809:policy/sample-api-service-dev-secrets-read \
  --role-only --role-name sample-api-service-dev-irsa \
  --approve --profile devops

aws iam get-role --role-name sample-api-service-dev-irsa --query Role.Arn --output text
```

Paste the resulting ARN over `<IRSA_ROLE_ARN>` in
`../Kustomize/Services/Sample_Api_Service/Base/serviceaccount.yaml` and commit
it - that annotation is the only piece Argo CD needs to grant the pod AWS
access.

## 5. Set up the OIDC role for secret-create's GitHub-hosted jobs

Unlike the IRSA roles above, `.github/workflows/secret-create.yml`'s
`ensure-aws-secret` job runs on `ubuntu-latest` (not in-cluster), so it
authenticates via GitHub's OIDC provider instead of a pod ServiceAccount.
One-time, account-wide:

```
# Computed live rather than hardcoded - GitHub has rotated this cert's CA
# before, which silently breaks any config that hardcodes the fingerprint.
THUMBPRINT=$(openssl s_client -connect token.actions.githubusercontent.com:443 \
  -servername token.actions.githubusercontent.com -showcerts </dev/null 2>/dev/null \
  | openssl x509 -fingerprint -sha1 -noout | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f')

aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list "$THUMBPRINT"
```

Skip that if another workflow in this account already has a GitHub OIDC
provider set up - it's a single account-wide resource, not per-role. Then
create the role itself:

```
aws iam create-role --role-name gha-secret-ops \
  --assume-role-policy-document file://eks/iam-trust-policy-secret-ops.json

aws iam put-role-policy --role-name gha-secret-ops --policy-name secret-ops \
  --policy-document file://eks/iam-policy-secret-ops.json

aws iam get-role --role-name gha-secret-ops --query Role.Arn --output text
```

`iam-trust-policy-secret-ops.json` scopes `sts:AssumeRoleWithWebIdentity` to
this one repo (`repo:yash2418/self-service-secrets:*`) via the OIDC `sub`
claim - no other repo's workflow runs can assume it.

Finally, set the two repository Variables `secret-create.yml` reads instead
of hardcoding these inline:

1. **Settings -> Secrets and variables -> Actions -> Variables tab -> New
   repository variable**.
2. Name `AWS_SECRET_OPS_ROLE_ARN`, value the full ARN printed by
   `get-role` above (`arn:aws:iam::951734991809:role/gha-secret-ops`).
3. New repository variable again: name `AWS_REGION`, value `ap-south-1`.

`secret-update.yml` also reads `AWS_REGION` (for its direct `aws
secretsmanager` calls from the in-cluster runner) - same variable, no
separate setup needed.

## 6. Set up the Argo CD Project Role for secret-create's apply-changes job

`apply-changes` triggers an Argo CD sync via the Argo CD API (the
`argocd app sync` CLI, baked into the runner image in
`infra/arc/runners/Dockerfile`) rather than kubectl-applying manifests
directly. It authenticates with a **Project Role token** scoped to
`sync`-only on one Application - not the Argo CD admin account.

```
# One-time: add the role + policy to the default AppProject.
kubectl patch appproject default -n argocd --type merge -p '{
  "spec": {
    "roles": [
      {
        "name": "secret-ops-sync",
        "description": "Sync-only access for secret-create workflow automation",
        "policies": [
          "p, proj:default:secret-ops-sync, applications, sync, default/sample-api-service-dev, allow"
        ]
      }
    ]
  }
}'
```

Generating the actual token needs one authenticated call to the Argo CD
API - bootstrap with the initial admin password (this is the only place it's
used; the resulting token is scoped far narrower):

```
kubectl port-forward svc/argocd-server -n argocd 8443:443 &

ADMIN_PW=$(kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath='{.data.password}' | base64 -d)

SESSION_TOKEN=$(curl -sk -X POST https://localhost:8443/api/v1/session \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PW}\"}" | jq -r .token)

curl -sk -X POST https://localhost:8443/api/v1/projects/default/roles/secret-ops-sync/token \
  -H "Authorization: Bearer ${SESSION_TOKEN}" -H "Content-Type: application/json" -d '{}' \
  | jq -r .token
```

Argo CD only returns that token once - it can't be retrieved again later
(`argocd proj role list-tokens` shows metadata like issue time, not the
token itself). Set it immediately:

1. **Settings -> Secrets and variables -> Actions -> Secrets tab -> New
   repository secret**. Name `ARGOCD_AUTH_TOKEN`, value the token above.
2. **Variables tab -> New repository variable**. Name `ARGOCD_SERVER`,
   value `argocd-server.argocd.svc.cluster.local` - the in-cluster DNS name
   for the Service, reachable from the dev-runners pod without needing the
   NodePort or any external address. No port suffix needed; `argocd` CLI
   defaults to 443, matching the Service's HTTPS port.

If you ever need to revoke it: `argocd-server` has no `--insecure` flag set
(check `kubectl get deploy argocd-server -n argocd -o jsonpath='{.spec.template.spec.containers[0].args}'`),
so it's serving HTTPS with the default self-signed cert - that's why
`apply-changes` passes `--insecure` (client-side skip-verify) to `argocd
app sync`, not because the server itself is unencrypted.

## 7. Verify

```
kubectl get pods -n kube-system -l app=csi-secrets-store
kubectl get pods -n kube-system -l app=csi-secrets-store-provider-aws

# after the Dev overlay has synced:
kubectl get secret sample-api-service-secret -n sample-api-service-dev
kubectl exec -n sample-api-service-dev deploy/sample-api-service -- ls /mnt/secrets-store
```

## 8. Tear down

```
eksctl delete cluster -f eks/cluster-dev.yaml
```
