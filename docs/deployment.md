# Deployment

Operator-facing runbook for getting opencode-chat onto a cluster and keeping
it there. For the one-time steps required before the *first* deploy (hostname,
DNS, TLS decision, platform prerequisites), see
[`pre-deploy-checklist.md`](pre-deploy-checklist.md) first — several of the
procedures below assume that checklist is already done.

## Secret creation runbook

The app's secrets are **not** templated into the Helm chart. They live in a
Kubernetes Secret named `opencode-chat-auth`, created out-of-band, and
consumed by the Deployment via `envFrom.secretRef`. Argo CD does not manage
this Secret, which is deliberate — see [Argo CD self-heal](#argo-cd-self-heal-and-manual-changes)
below.

Create it with:

```sh
kubectl -n opencode-chat create secret generic opencode-chat-auth --from-env-file=.env
```

The `.env` file for this command must contain **exactly** these four keys —
five when `app.searchProvider=brave` (the chart's default; see
[Web search (Wave 1.5)](#web-search-wave-15) below) — and nothing else:

```
OPENCODE_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
BRAVE_SEARCH_API_KEY=...   # only when app.searchProvider=brave
```

**Do not point this command at the repo-root dev `.env`.** That file (copied
from `.env.example`) carries several more variables — `APP_ORIGIN`,
`ALLOWED_EMAILS`, `DATABASE_URL`, `DAILY_MESSAGE_LIMIT`, `COOKIE_SECURE`,
`OPENCODE_BASE_URL`, `OPENCODE_MODELS`, `WEB_SEARCH_ENABLED`,
`SEARCH_PROVIDER`, `SEARXNG_BASE_URL`, `TOOL_CAPABLE_MODELS` — that are chart
**values**, not secret keys. Those are set via
`charts/opencode-chat/values.yaml` (or a `--set`/values override at install
time), not via this Secret. `DATABASE_URL` in particular is never part of
`opencode-chat-auth` — it comes from the chart-managed `db-credentials`
Secret instead.

Keep a separate, minimal `.env` (e.g. `.env.secret`, untracked, never
committed) with just the keys above for this command, distinct from the
dev `.env` you use for `npm run dev`.

### Web search (Wave 1.5)

The chat model can call two tools, `web_search` and `web_fetch`, gated by
`app.webSearchEnabled` (chart) / `WEB_SEARCH_ENABLED` (local dev). The search
backend is `app.searchProvider`, one of:

- `brave` — the chart default. Hosted, no cluster workload to run, but needs
  `BRAVE_SEARCH_API_KEY` in `opencode-chat-auth` (above).
- `searxng` — no API key, but needs a SearXNG instance reachable at
  `app.searxngBaseUrl` **with JSON output enabled** (`formats: [html,
  json]` in its `settings.yml` — a stock SearXNG only serves HTML and every
  search 403s without this). Local dev's `docker-compose.dev.yml` runs one
  pre-configured this way; running SearXNG in the cluster is not something
  this chart sets up — bring your own if you want `searxng` there instead of
  `brave`.

An unknown `SEARCH_PROVIDER`/`app.searchProvider` value fails the pod at
boot, not at the first search.

If the namespace doesn't exist yet:

```sh
kubectl create namespace opencode-chat
```

## Google Cloud console steps

opencode-chat reuses the **existing** Google OAuth client from a sibling
project — there is no new OAuth client, no new consent screen, no new domain
verification. The only console change is adding a second redirect URI:

1. Google Cloud console → **APIs & Services → Credentials**.
2. Open the existing OAuth 2.0 Client ID (the one already used by the sibling
   project).
3. Under **Authorized redirect URIs**, add:
   ```
   https://<CHAT_HOSTNAME>/auth/google/callback
   ```
   where `<CHAT_HOSTNAME>` is the real hostname chosen in the
   [pre-deploy checklist](pre-deploy-checklist.md) (e.g. `chat.example.com`).
4. Save.

This must match `APP_ORIGIN` **character-for-character**: same scheme
(`https://`), same host, **no trailing slash**. `APP_ORIGIN` is set as a
chart value (`appOrigin` in `values.yaml`), and the app builds the callback
URL as `APP_ORIGIN + /auth/google/callback` at runtime — any mismatch here
(http vs https, a trailing slash, wrong subdomain) surfaces as Google
rejecting the callback.

> **`redirect_uri_mismatch` is the single most common first-deploy failure.**
> If login fails immediately after the OAuth screen with that error, this is
> the first thing to check — re-read the URI in the console against the exact
> value of `APP_ORIGIN` in the deployed values, byte for byte.

Local dev uses `http://localhost:4200` because Angular's dev server proxies
the callback to the API. Add
`http://localhost:4200/auth/google/callback` to the existing client's
authorized redirect URIs before testing the local login round-trip.

## Release / rollback procedure

### Release flow

1. Tag a release: `git tag v0.x.y && git push origin main v0.x.y`.
2. `.github/workflows/release.yml` builds and pushes
   `ghcr.io/lkroon/opencode-chat:v0.x.y`.
3. The same workflow commits the new `imageTag` into
   `charts/opencode-chat/values.yaml`, with `[skip ci]` in the commit message
   so the bump commit doesn't retrigger CI.
4. Argo CD (automated sync, self-heal enabled) notices the values change and
   syncs the cluster to the new image — no manual `kubectl` step for a normal
   release.

### Rollback is one-way for schema

**Reverting `imageTag` rolls the code back. It does not roll the database
schema back.** Two things make this true and neither is optional:

- Migrations run as a Helm hook (`post-install,pre-upgrade`), **not on app
  boot**. They run once, at sync time, against whatever schema state the
  database is currently in — they never run backwards.
- `revisionHistoryLimit: 1` means the Deployment keeps no prior ReplicaSet to
  fall back to beyond the immediately preceding one, and Argo CD's self-heal
  will re-apply the chart's current desired state (including the current
  `imageTag`) if anything drifts — there is no "undo" button that also
  reverts the schema.

So: if you revert `imageTag` to an older release after a migration has
already run, you get **old code running against new schema**. That only
works if the migration was written to be backward-compatible with the
previous code — which is not true by default.

**Practical consequence:** any migration that drops a column, narrows a
column's type, or removes a table that older code still reads/writes must be
split across **two releases**, not shipped as one:

1. **Release N:** add the new column/table and backfill it. Old code and new
   code both still work against this schema (old code ignores the new
   column; new code writes to it).
2. **Release N+1, later:** once you're confident you won't roll back past
   release N, ship the migration that actually drops/narrows the old column
   or table.

A migration that drops or narrows something in the *same* release that
starts depending on the new shape is **not rollable at all** — reverting
`imageTag` after it runs will leave you with code that expects a column the
database no longer has.

### Rolling back code only

If you need to revert to a previous image and are certain no schema-breaking
migration has run since (or the migration was written to be
backward-compatible per above):

```sh
# Edit charts/opencode-chat/values.yaml: set imageTag back to the previous tag
git add charts/opencode-chat/values.yaml
git commit -m "chore: roll back imageTag to v0.x.y [skip ci]"
git push
```

Argo CD self-heal picks up the commit and syncs. Do **not** `kubectl edit` or
`kubectl set image` the Deployment directly — Argo CD will revert a
hand-applied change back to whatever's in the chart within its next
reconcile. The git commit is the only durable way to change what's deployed.

## Secret-refresh runbook

To rotate or update any of the four keys in `opencode-chat-auth` (e.g. a
rotated `OPENCODE_API_KEY`, a new `SESSION_SECRET`), re-create the Secret and
restart the Deployment to pick it up — the app reads env vars at process
start, it does not watch the Secret for changes.

```sh
kubectl -n opencode-chat create secret generic opencode-chat-auth \
  --from-env-file=.env --dry-run=client -o yaml | kubectl apply -f -
kubectl -n opencode-chat rollout restart deployment/opencode-chat
```

(`.env` here is the minimal four-key file described in
[Secret creation runbook](#secret-creation-runbook) above, not the dev
`.env`.)

### Argo CD self-heal and manual changes

Argo CD has self-heal enabled on the `opencode-chat` Application: **anything
applied by hand to the `opencode-chat` namespace that conflicts with what the
chart declares gets reverted**, usually within a few minutes. This is why the
secret-refresh procedure above only ever touches the `Secret` and does a
`rollout restart` — both of those are safe:

- The `opencode-chat-auth` Secret is created **out-of-band** and is not part
  of the chart's rendered manifests, so Argo CD doesn't manage it and won't
  revert changes to it.
- `kubectl rollout restart` doesn't change the Deployment's declared spec (no
  drift from the chart's desired state), so self-heal has nothing to correct.

**Do not** `kubectl edit deployment/opencode-chat` or `kubectl apply` a
modified Deployment/Service/Ingress manifest directly — those *are* managed
by the chart, and a hand-applied change to them will be silently reverted by
self-heal on the next reconcile, which is confusing to debug if you don't
know to expect it. If you need a temporary change to a chart-managed
resource (e.g. for local debugging), pause auto-sync on the Application in
the Argo CD UI first.

## GHCR package visibility (one-time)

The first `v*` tag push creates the `ghcr.io/lkroon/opencode-chat` package as
**private** by default. Every Argo CD sync after that will fail to pull the
image (`ImagePullBackOff`) until the package is made public, or the cluster
is given credentials to pull it.

**Default assumption for this project: make it public.** Steps:

1. GitHub → the repo/org's **Packages** tab → `opencode-chat`.
2. **Package settings** → **Change visibility** → **Public**.

This is a one-time, manual step — it is not automatable from the `release.yml`
workflow (package visibility isn't something the `GITHUB_TOKEN` used by that
workflow can change).

**Alternative, if you don't want the image public:** add `imagePullSecrets`
to the chart's Deployment plus a `kubernetes.io/dockerconfigjson` Secret
created out-of-band (same pattern as `opencode-chat-auth`) with a GHCR
read token. This is not the default for this project — only do it if the
operator explicitly decides against making the package public.
