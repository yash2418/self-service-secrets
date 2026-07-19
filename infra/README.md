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

## 5. Verify

```
kubectl get pods -n kube-system -l app=csi-secrets-store
kubectl get pods -n kube-system -l app=csi-secrets-store-provider-aws

# after the Dev overlay has synced:
kubectl get secret sample-api-service-secret -n sample-api-service-dev
kubectl exec -n sample-api-service-dev deploy/sample-api-service -- ls /mnt/secrets-store
```

## 6. Tear down

```
eksctl delete cluster -f eks/cluster-dev.yaml
```
