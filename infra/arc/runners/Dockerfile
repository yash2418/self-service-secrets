# Use the official ARC runner base image
FROM ghcr.io/actions/actions-runner:latest

# Switch to root to install system packages
USER root

# Install standard utilities, git, and jq
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG YQ_VERSION=v4.44.3
ARG KUBECTL_VERSION=v1.31.0
ARG AWSCLI_VERSION=2.17.62
# Must match the deployed argocd-server's version (currently v3.4.5, per
# `kubectl get deploy argocd-server -n argocd -o jsonpath='{.spec.template.spec.containers[0].image}'`)
# to avoid client/server API skew - update this alongside any server upgrade.
ARG ARGOCD_VERSION=v3.4.5

# Install yq (binary download)
RUN curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64" -o /usr/local/bin/yq \
    && chmod +x /usr/local/bin/yq

# Install AWS CLI v2
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWSCLI_VERSION}.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip ./aws

# Install kubectl
RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

# Install argocd CLI - used by secret-create's apply-changes job to trigger
# + wait for a sync via the Argo CD API (scoped project-role token), rather
# than kubectl-applying manifests directly or waiting on Argo CD's own
# automated poll interval.
RUN curl -fsSL "https://github.com/argoproj/argo-cd/releases/download/${ARGOCD_VERSION}/argocd-linux-amd64" -o /usr/local/bin/argocd \
    && chmod +x /usr/local/bin/argocd

# Revert back to the non-root runner user required by ARC
USER runner
