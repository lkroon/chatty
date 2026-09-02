# Pre-deploy checklist

One-time manual steps that must happen, **in order**, before the first real
deploy to the public host. None of this is automatable from CI — it's
operator judgment (picking a hostname, deciding on TLS) and console/DNS
actions outside this repo.

Every reference to the public hostname in this repo uses the literal
placeholder token `__CHAT_HOSTNAME__`. Do not invent a hostname while writing
code or config — that token gets replaced exactly once, in step 2 below.

## Steps

**1. Cut a pre-release tag**

```sh
git tag v0.1.0-rc.1 && git push origin main v0.1.0-rc.1
```

This makes the release workflow build and push a pullable image before
anything tries to sync against a real cluster. (This also satisfies Gate 2's
precondition that an `imageTag` actually exists to pull.)

**2. Pick the subdomain and replace the placeholder**

Choose the real hostname (e.g. `chat.example.com`) and replace every
occurrence of `__CHAT_HOSTNAME__` in the repo — at minimum
`charts/opencode-chat/values.yaml` (`ingress.host` and `appOrigin`) and any
setup instructions in `README.md` that still carry the token.

Verify nothing was missed:

```sh
grep -rn __CHAT_HOSTNAME__ .
```

Must come back empty before continuing.

**3. DNS**

Point an A/AAAA record for the chosen hostname at the ingress's public IP —
or, if fronting with a tunnel (e.g. Cloudflare Tunnel), add the public
hostname route there instead.

**4. Google Cloud console redirect URI**

Add `https://<CHAT_HOSTNAME>/auth/google/callback` to the existing OAuth
client's Authorized redirect URIs. Must match `APP_ORIGIN`
character-for-character (scheme, host, no trailing slash). See
[`deployment.md` → Google Cloud console steps](deployment.md#google-cloud-console-steps)
for the full walkthrough — this is the step most likely to bite on first
deploy (`redirect_uri_mismatch`).

**5. GHCR package visibility**

Make `ghcr.io/lkroon/opencode-chat` public (default assumption for this
project), or add `imagePullSecrets` to the chart instead. See
[`deployment.md` → GHCR package visibility](deployment.md#ghcr-package-visibility-one-time).
Every Argo CD sync will `ImagePullBackOff` until this is done.

**6. Create the `opencode-chat-auth` Secret**

```sh
kubectl -n opencode-chat create secret generic opencode-chat-auth --from-env-file=.env
```

with a minimal `.env` containing exactly `OPENCODE_API_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, plus
`BRAVE_SEARCH_API_KEY` if you're keeping the chart's default
`app.searchProvider=brave` (Wave 1.5 web search). See
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
kubectl apply -f argocd/opencode-chat.yaml
```

This is a one-time bootstrap — after this, Argo CD manages its own sync
(automated, with prune and self-heal) and you don't re-apply this file for
routine releases.

**9. TLS decision**

There is no cert-manager and no ClusterIssuer on the reference cluster
today, and the `frameworks` ingress it's modeled on has no `tls:` block — it
serves plain http on `localtest.me`. For opencode-chat's public host, this is
a real decision, not a given. Pick one:

- **Install cert-manager + a ClusterIssuer** on the target cluster and enable
  the chart's conditional `tls:` block (`ingress.tls.enabled` +
  `ingress.tls.secretName`, or a `clusterIssuer` annotation).
- **Terminate TLS at a tunnel** (e.g. Cloudflare Tunnel) and leave the
  ingress itself on plain http.

Either way, the public host needs `COOKIE_SECURE=true` and
`APP_ORIGIN=https://<CHAT_HOSTNAME>`. That combination makes `trust proxy`
mandatory on the Express side — this is already set (`app.set('trust proxy',
1)` in `main.ts`, before session middleware) and is not something the
operator needs to touch, but it's why `COOKIE_SECURE=true` won't silently
"just work" without a TLS-terminating proxy in front of the app one way or
the other.

**10. Confirm the platform layer is running on the target cluster**

ingress-nginx, Argo CD, and **metrics-server** must already be installed and
running on the target cluster before the Application is applied. This is a
real prerequisite, not a given: neither `lkroon/charts` nor
`lkroon/frameworks` deploys these to a real (non-kind) cluster today — the
only cluster either of those repos bootstraps is local `kind`. If the target
cluster is a fresh Hetzner box, install all three before step 8.

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
