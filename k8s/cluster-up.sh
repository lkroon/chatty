#!/usr/bin/env bash
# Bootstrap the local kind cluster for GitOps. Installs the platform layer
# (ingress, metrics-server, Argo CD) and the out-of-band secret, then hands
# control to Argo CD, which deploys chatty from this same repo's
# charts/chatty chart. This script does NOT build or deploy the app
# image — that's a separate release step (see .github/workflows, once it
# exists).
#
# Idempotent; rerun freely. After `kind delete cluster --name chatty`,
# this recreates everything except the database contents.
set -euo pipefail

cd "$(dirname "$0")/.."

CLUSTER=chatty
CTX="kind-$CLUSTER"
INGRESS_NGINX_MANIFEST=https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
METRICS_SERVER_MANIFEST=https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
ARGOCD_MANIFEST=https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# Applied from the local checkout, not a remote raw URL: unlike the
# frameworks/charts split, this repo carries its own Application manifest.
# The -kind variant layers charts/chatty/values-kind.yaml over values.yaml so
# the localtest.me host and plain-http cookie stay out of the production
# values Argo CD syncs to Hetzner.
APPLICATION_MANIFEST=argocd/chatty-kind.yaml

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found at repo root. Create it with SESSION_SECRET," >&2
  echo "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and OPENCODE_API_KEY (values" >&2
  echo "unquoted) -- these four map straight onto the chatty-auth" >&2
  echo "Secret. Non-secret app config (APP_ORIGIN, ALLOWED_EMAILS, etc.)" >&2
  echo "belongs in charts/chatty/values.yaml, not here." >&2
  exit 1
fi

# 1. Cluster (host ports 80/443 -> ingress)
if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  kind create cluster --config k8s/kind-config.yaml
fi

# 2. Ingress controller
kubectl --context "$CTX" get deploy -n ingress-nginx ingress-nginx-controller >/dev/null 2>&1 || \
  kubectl --context "$CTX" apply -f "$INGRESS_NGINX_MANIFEST"
kubectl --context "$CTX" wait -n ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s

# 3. metrics-server (kind kubelets use self-signed certs)
kubectl --context "$CTX" get deploy -n kube-system metrics-server >/dev/null 2>&1 || {
  kubectl --context "$CTX" apply -f "$METRICS_SERVER_MANIFEST"
  kubectl --context "$CTX" -n kube-system patch deploy metrics-server --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
}

# 4. App namespace + the one secret that never enters git
kubectl --context "$CTX" create namespace chatty --dry-run=client -o yaml \
  | kubectl --context "$CTX" apply -f -
kubectl --context "$CTX" -n chatty create secret generic chatty-auth \
  --from-env-file=.env --dry-run=client -o yaml \
  | kubectl --context "$CTX" apply -f -

# 5. Argo CD (UI at http://argocd.localtest.me, user admin)
if ! kubectl --context "$CTX" get ns argocd >/dev/null 2>&1; then
  kubectl --context "$CTX" create namespace argocd
  kubectl --context "$CTX" apply --server-side -n argocd -f "$ARGOCD_MANIFEST"
  # Plain http behind the nginx ingress
  kubectl --context "$CTX" -n argocd patch configmap argocd-cmd-params-cm \
    --type merge -p '{"data":{"server.insecure":"true"}}'
  kubectl --context "$CTX" -n argocd rollout restart deploy argocd-server
  cat <<'EOF' | kubectl --context "$CTX" apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argocd
  namespace: argocd
spec:
  ingressClassName: nginx
  rules:
    - host: argocd.localtest.me
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: argocd-server
                port:
                  number: 80
EOF
fi
kubectl --context "$CTX" -n argocd rollout status deploy/argocd-server --timeout=300s

# 6. The Application: from here on, Argo CD owns app deployment
kubectl --context "$CTX" apply -f "$APPLICATION_MANIFEST"

echo
echo "Bootstrap done. Argo CD will sync chatty from this repo."
echo "  app:     http://chatty.localtest.me/  (Google SSO)"
echo "  argocd:  http://argocd.localtest.me/          (admin; password below)"
kubectl --context "$CTX" -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' 2>/dev/null | base64 -d && echo
