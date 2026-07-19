# toolsImage for the secret-update/secret-create WorkflowTemplates. Bundles
# every CLI tool either template's steps invoke: git, yq v4 (mikefarah), jq,
# aws-cli v2, kubectl, gh. One shared image is simplest to build/maintain
# since no single step needs more than a subset of these.
#
# Build:  docker build -t <ECR_REPO>/argo-secret-ops-tools:latest infra/tools-image
# Push:   docker push <ECR_REPO>/argo-secret-ops-tools:latest
FROM debian:bookworm-slim

ARG YQ_VERSION=v4.44.3
ARG KUBECTL_VERSION=v1.31.0
ARG AWSCLI_VERSION=2.17.62

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq unzip gnupg \
    && curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64" -o /usr/local/bin/yq \
    && chmod +x /usr/local/bin/yq \
    && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWSCLI_VERSION}.zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/awscliv2.zip /tmp/aws \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && apt-get purge -y unzip gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
