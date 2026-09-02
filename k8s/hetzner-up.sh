#!/usr/bin/env bash
# Bootstrap the Hetzner box into a cluster Chatty can be deployed to, then
# hand control to Argo CD. Run this ON the server, as root, once:
#
#   ssh root@chat.lkroon.nl
#   git clone https://github.com/lkroon/chatty.git && cd chatty
#   ./k8s/hetzner-up.sh --secret-env /root/chatty-auth.env
#
# It is the production sibling of cluster-up.sh (which does the same job for
# a local kind cluster) and is idempotent: rerun it freely, it skips whatever
# is already in place.
#
# What it does NOT do, deliberately:
#   - configure a firewall. Use the Hetzner Cloud Firewall in the console
#     instead: allow 22, 80, 443 inbound, deny the rest. A host firewall like
#     ufw sits in the same netfilter tables k3s programs for pod networking,
#     and enabling it without the right allowances is a well-known way to
#     break CNI traffic on a cluster that was working a minute earlier.
#     Port 80 must stay open permanently, not just for the first deploy:
#     Let's Encrypt renews over HTTP-01 every ~60 days.
#   - expose Argo CD publicly. See the note at the end of the run.
#   - create DNS records, or touch the Google OAuth client. Those are
#     docs/pre-deploy-checklist.md steps 3 and 4, and must already be done.
set -euo pipefail

HOST=chat.lkroon.nl
ACME_EMAIL=luckroon92@gmail.com
NAMESPACE=chatty
SECRET_NAME=chatty-auth
SECRET_ENV=""
ARGOCD_VARIANT=full   # or 'core' via --argocd-core

INGRESS_NGINX_MANIFEST=https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
CERT_MANAGER_MANIFEST=https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
ARGOCD_FULL_MANIFEST=https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
ARGOCD_CORE_MANIFEST=https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/core-install.yaml
APPLICATION_MANIFEST_URL=https://raw.githubusercontent.com/lkroon/chatty/main/argocd/chatty.yaml

while [[ $# -gt 0 ]]; do
  case "$1" in
    --secret-env) SECRET_ENV="$2"; shift 2 ;;
    --argocd-core) ARGOCD_VARIANT=core; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
[[ $EUID -eq 0 ]] || fail "run as root (k3s installs system-wide)"
[[ -n "$SECRET_ENV" ]] || fail "--secret-env <file> is required. See the SECRET section below."
[[ -f "$SECRET_ENV" ]] || fail "secret env file not found: $SECRET_ENV"

# Every key the app reads from the Secret. BRAVE_SEARCH_API_KEY is required,
# not optional: values.yaml ships webSearchEnabled: true with
# searchProvider: brave, and the pod deliberately fails at boot without it.
SECRET_KEYS=(OPENCODE_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_SECRET BRAVE_SEARCH_API_KEY)
SECRET_ARGS=()
for key in "${SECRET_KEYS[@]}"; do
  value=$(grep -E "^${key}=" "$SECRET_ENV" | tail -n1 | cut -d= -f2- || true)
  [[ -n "$value" ]] || fail "${key} missing or empty in ${SECRET_ENV}"
  SECRET_ARGS+=(--from-literal="${key}=${value}")
done

# The DNS record has to be right before cert-manager asks Let's Encrypt to
# fetch a challenge over it. Getting this wrong burns the per-hostname
# failed-order rate limit, which costs a week, so it is checked up front.
resolved=$(getent ahostsv4 "$HOST" | awk 'NR==1{print $1}' || true)
public_ip=$(curl -fsS --max-time 10 https://ipv4.icanhazip.com || true)
[[ -n "$resolved" ]] || fail "$HOST does not resolve. Create the A record first (checklist step 3)."
if [[ -n "$public_ip" && "$resolved" != "$public_ip" ]]; then
  fail "$HOST resolves to $resolved but this host's public IP is $public_ip.
Fix the A record, or wait out the TTL, before running this — a failed ACME
order counts against a rate limit that resets weekly."
fi
echo "preflight ok: $HOST -> $resolved (this host)"

# ------------------------------------------------------------------- k3s
step "k3s"
if ! command -v k3s >/dev/null 2>&1; then
  # Traefik off: ingress-nginx owns :80/:443, and the chart's SSE
  # annotations are nginx-specific (proxy-buffering off is what keeps
  # POST /api/chat streaming instead of arriving in one lump).
  # servicelb (klipper) is kept: it is what binds the ingress controller's
  # LoadBalancer Service to the node's own IP.
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=600" sh -
else
  echo "k3s already installed, skipping"
fi
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# `systemctl start k3s` returns before the apiserver is serving and before
# the node has registered itself, so a bare `kubectl wait node --all` on a
# fresh install exits immediately with "error: no matching resources found"
# — waiting for *all* of an empty set is vacuously satisfied. Observed on
# the first real run. Wait for the node to exist before waiting on it.
echo "waiting for the apiserver and node registration..."
for attempt in $(seq 1 60); do
  if [[ -n "$(kubectl get nodes -o name 2>/dev/null)" ]]; then break; fi
  [[ $attempt -eq 60 ]] && fail "k3s apiserver never registered a node (check: journalctl -u k3s)"
  sleep 5
done
kubectl wait --for=condition=ready node --all --timeout=300s

# k3s bundles metrics-server; Gate 3's `kubectl top nodes` needs it running.
# It is applied by k3s's own manifest reconciler shortly after start, so it
# may not exist yet either.
for attempt in $(seq 1 60); do
  if kubectl -n kube-system get deploy metrics-server >/dev/null 2>&1; then break; fi
  [[ $attempt -eq 60 ]] && fail "k3s never deployed metrics-server"
  sleep 5
done
kubectl -n kube-system rollout status deploy/metrics-server --timeout=300s

# --------------------------------------------------------------- ingress
step "ingress-nginx"
if ! kubectl get deploy -n ingress-nginx ingress-nginx-controller >/dev/null 2>&1; then
  kubectl apply -f "$INGRESS_NGINX_MANIFEST"
fi
kubectl wait -n ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=300s

# ----------------------------------------------------------- cert-manager
step "cert-manager + letsencrypt-prod ClusterIssuer"
if ! kubectl get ns cert-manager >/dev/null 2>&1; then
  kubectl apply -f "$CERT_MANAGER_MANIFEST"
fi
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
# The webhook is reachable a moment after the rollout reports done; retry the
# first ClusterIssuer apply rather than failing the whole bootstrap on it.
for attempt in 1 2 3 4 5; do
  if kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ${ACME_EMAIL}
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
EOF
  then break; fi
  [[ $attempt -eq 5 ]] && fail "ClusterIssuer apply kept failing (webhook not ready?)"
  echo "  webhook not ready yet, retrying in 10s ($attempt/5)"
  sleep 10
done

# --------------------------------------------------------------- argo cd
step "Argo CD ($ARGOCD_VARIANT)"
if ! kubectl get ns argocd >/dev/null 2>&1; then
  kubectl create namespace argocd
  if [[ "$ARGOCD_VARIANT" == core ]]; then
    kubectl apply --server-side -n argocd -f "$ARGOCD_CORE_MANIFEST"
  else
    kubectl apply --server-side -n argocd -f "$ARGOCD_FULL_MANIFEST"
  fi
fi
kubectl -n argocd rollout status deploy/argocd-repo-server --timeout=600s

# ------------------------------------------------------- namespace + secret
step "namespace + $SECRET_NAME Secret"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create secret generic "$SECRET_NAME" \
  "${SECRET_ARGS[@]}" --dry-run=client -o yaml | kubectl apply -f -

# --------------------------------------------------------- budget check
step "resource budget before deploying anything"
kubectl top nodes || echo "  (metrics not populated yet — rerun 'kubectl top nodes' in a minute)"
free -h | head -2

# ------------------------------------------------------------ application
step "Argo CD Application"
if [[ -f argocd/chatty.yaml ]]; then
  kubectl apply -f argocd/chatty.yaml
else
  kubectl apply -f "$APPLICATION_MANIFEST_URL"
fi

cat <<EOF

────────────────────────────────────────────────────────────────────
Bootstrap done. Argo CD now owns deployment; it syncs charts/chatty
from the repo's main branch on its own.

Watch the first sync:
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  kubectl -n argocd get application chatty -w
  kubectl -n $NAMESPACE get pods -w

Certificate (takes ~1 minute after the ingress appears):
  kubectl -n $NAMESPACE get certificate,order,challenge
A Certificate stuck not-Ready almost always means the HTTP-01 challenge
could not be fetched — check that port 80 is open in the Hetzner Cloud
Firewall, from outside the box.

Argo CD is NOT exposed publicly, on purpose: it holds cluster-wide write
access and lives one hostname away from an app on the open internet.
Reach it from your laptop over SSH instead:
EOF
if [[ "$ARGOCD_VARIANT" == core ]]; then
cat <<EOF
  # Argo CD core has no web UI. Use kubectl (or the argocd CLI) over SSH,
  # or copy /etc/rancher/k3s/k3s.yaml to your laptop, swap the server
  # address for https://$HOST:6443, and drive it with k9s.
EOF
else
cat <<EOF
  ssh -L 8080:localhost:8080 root@$HOST \\
    'KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n argocd port-forward svc/argocd-server 8080:80'
  # then open http://localhost:8080  (user: admin)
  # password:
  kubectl -n argocd get secret argocd-initial-admin-secret \\
    -o jsonpath='{.data.password}' | base64 -d; echo
EOF
fi
cat <<EOF

The app itself: https://$HOST/
────────────────────────────────────────────────────────────────────
EOF
