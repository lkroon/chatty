# Pre-deploy checklist

One-time manual steps that must happen, **in order**, before the first real
deploy to the public host. None of this is automatable from CI — it's
operator judgment (picking a hostname, deciding on TLS) and console/DNS
actions outside this repo.

The two decisions this checklist used to leave open are now made and baked
into `charts/chatty/values.yaml`: the public host is **`chat.lkroon.nl`** and
TLS terminates **at the ingress, with a cert-manager-issued Let's Encrypt
cert**. The steps below are what remains for the operator.

The target is a Hetzner CX23 (`ubuntu-4gb-hel1-2`, 2 vCPU / 4 GB, Helsinki),
shared with whatever else already runs there — which is why §4-G's 400 Mi /
250 m request budget and step 10's `kubectl top nodes` are not optional.

## Steps

**1. Cut a pre-release tag**

```sh
git tag v0.1.0-rc.1 && git push origin main v0.1.0-rc.1
```

This makes the release workflow build and push a pullable image before
anything tries to sync against a real cluster. (This also satisfies Gate 2's
precondition that an `imageTag` actually exists to pull.)

**2. Hostname — already set, verify only**

`chat.lkroon.nl` is committed in `charts/chatty/values.yaml` as both
`ingress.host` and `app.origin` (`https://`, no trailing slash). The local
kind gate uses `chatty.localtest.me` from `values-kind.yaml` instead, layered
on by `argocd/chatty-kind.yaml` — production values are never edited to run
Gate 2.

```sh
grep -rn "chat.lkroon.nl" charts/chatty/values.yaml
```

**3. DNS**

An `A` record for `chat.lkroon.nl` pointing at the Hetzner server's primary
public IPv4, and optionally an `AAAA` from its `/64`. A **floating IP is not
needed**: it buys IP portability across servers, which matters for failover
or rebuild-in-place, and costs a monthly fee to do nothing for a single box
whose DNS record you can edit. Add one later if the deployment ever grows a
second node.

The record must resolve before step 9's cert-manager HTTP-01 challenge can
succeed — Let's Encrypt validates by fetching
`http://chat.lkroon.nl/.well-known/acme-challenge/...` through the ingress.

**4. Google Cloud console redirect URI**

Add `https://<CHAT_HOSTNAME>/auth/google/callback` to the existing OAuth
client's Authorized redirect URIs. Must match `APP_ORIGIN`
character-for-character (scheme, host, no trailing slash). See
[`deployment.md` → Google Cloud console steps](deployment.md#google-cloud-console-steps)
for the full walkthrough — this is the step most likely to bite on first
deploy (`redirect_uri_mismatch`).

**5. GHCR package visibility**

Make `ghcr.io/lkroon/chatty` public (default assumption for this
project), or add `imagePullSecrets` to the chart instead. See
[`deployment.md` → GHCR package visibility](deployment.md#ghcr-package-visibility-one-time).
Every Argo CD sync will `ImagePullBackOff` until this is done.

**6. Create the `chatty-auth` Secret**

```sh
kubectl -n chatty create secret generic chatty-auth --from-env-file=.env
```

with a minimal `.env` containing exactly `OPENCODE_API_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` and
`BRAVE_SEARCH_API_KEY`.

**The Brave key is required, not optional.** The chart ships
`app.webSearchEnabled: true` with `app.searchProvider: brave`, and that
combination fails the pod at boot when the key is missing — deliberately, so
a misconfiguration surfaces on the first sync instead of at somebody's first
search. Get a free key at <https://brave.com/search/api/> (2,000
queries/month, far beyond single-user use). The alternative is setting
`app.webSearchEnabled: false` in values, which drops the app back to
pre-Wave-1.5 behaviour. See
[`deployment.md` → Secret creation runbook](deployment.md#secret-creation-runbook)
and [`deployment.md` → Web search](deployment.md#web-search-wave-15) — do not
reuse the full dev `.env` for this.

**7. Set `ALLOWED_EMAILS` to the real allowlist**

Do this **before step 3's DNS record goes live** (or at minimum, before it
resolves publicly) — the allowlist is the only thing standing between the
open internet and the metered OpenCode key once the app is reachable.
`ALLOWED_EMAILS` is a chart value (`values.yaml`), a CSV of full email
addresses, matched case-insensitively.

**8. Apply the Argo CD Application once, by hand**

```sh
kubectl apply -f argocd/chatty.yaml
```

This is a one-time bootstrap — after this, Argo CD manages its own sync
(automated, with prune and self-heal) and you don't re-apply this file for
routine releases.

**9. TLS — cert-manager, and it must exist before the first sync**

The decision is made: TLS terminates at the ingress. `values.yaml` ships
`ingress.tls.enabled: true`, `secretName: chatty-tls` and
`clusterIssuer: letsencrypt-prod`, so **cert-manager and a ClusterIssuer of
that exact name must already be on the cluster** — the chart only writes the
annotation, it does not install either. Do this as part of step 10, before
step 8's apply:

```sh
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: luckroon92@gmail.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
EOF
```

Rehearse against the staging endpoint
(`https://acme-staging-v02.api.letsencrypt.org/directory`) first if you
expect to iterate — the production endpoint rate-limits failed orders per
hostname, and burning that limit costs you a week.

The public host needs `COOKIE_SECURE=true` and
`APP_ORIGIN=https://<CHAT_HOSTNAME>`. That combination makes `trust proxy`
mandatory on the Express side — this is already set (`app.set('trust proxy',
1)` in `main.ts`, before session middleware) and is not something the
operator needs to touch, but it's why `COOKIE_SECURE=true` won't silently
"just work" without a TLS-terminating proxy in front of the app one way or
the other.

**10. Build the platform layer on the Hetzner box**

There is no Kubernetes on `ubuntu-4gb-hel1-2` yet, and nothing in
`lkroon/charts` or `lkroon/frameworks` puts it there — the only cluster
either repo bootstraps is local `kind`. Everything below is a prerequisite of
step 8, not a consequence of it:

1. **k3s**, with its bundled Traefik disabled so ingress-nginx owns :80/:443:
   `curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik --disable=servicelb" sh -`
   (`--disable=servicelb` only if you front it with hostPorts; keep klipper-lb
   if you want a LoadBalancer Service to bind the node IP.)
2. **ingress-nginx**, **Argo CD**, **metrics-server** — the same three
   `k8s/cluster-up.sh` installs on kind, minus the `--kubelet-insecure-tls`
   patch, which is a kind-only workaround.
3. **cert-manager + the `letsencrypt-prod` ClusterIssuer** from step 9.
4. `kubectl top nodes` **before** applying the Application, to confirm the
   400 Mi / 250 m request budget actually fits beside what already runs
   there. A 4 GB node with k3s, ingress-nginx and Argo CD on it has less
   headroom than the number suggests.

Firewall: 80 and 443 open to the world (443 for the app, 80 for the ACME
HTTP-01 challenge — closing it breaks certificate renewal three months
later, long after you've forgotten why it was open). 6443 should **not** be
public; reach the API server over SSH port-forwarding or a tunnel.

## After this checklist

Once all ten steps are done, the first sync should go Healthy and the OAuth
round-trip should work against the real public host. If it doesn't:

- `ImagePullBackOff` → re-check step 5 (GHCR visibility).
- Login fails at the Google screen with `redirect_uri_mismatch` → re-check
  step 4 against the exact deployed `APP_ORIGIN`.
- Login succeeds but the session doesn't stick → re-check step 9
  (`COOKIE_SECURE` / `APP_ORIGIN` scheme mismatch, or a proxy in front that
  `trust proxy` isn't accounting for).
- Sync never goes Healthy and the Deployment can't reach Postgres → check
  that the migrate Job (a `post-install,pre-upgrade` Helm hook) actually
  completed; see [`deployment.md`](deployment.md) for how migrations are
  wired.
