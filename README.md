# opencode-chat

A bare-bones, single-user (plus allowlist) chat web app that proxies prompts
to the OpenCode Go subscription. NestJS backend, Angular frontend, installed
on iOS as a home-screen web app.

- **Backend:** NestJS 11 (Express adapter), `apps/api`
- **Frontend:** Angular 20, standalone components, signals, `apps/web`
- **Shared types:** `libs/contracts` — DTOs and SSE event shapes, source of truth for both apps
- **History storage:** Postgres, via Drizzle
- **Deployment:** Helm chart + Argo CD Application, in this same repo

### Monorepo, not a repo split

Unlike a previous project on this cluster that split app code and Helm chart
across two repos, **opencode-chat is a single monorepo**: `apps/`, `libs/`,
`charts/opencode-chat/`, and `argocd/opencode-chat.yaml` all live here
together. Two consequences fall out of that if you're used to the split
pattern:

- Argo CD's `Application` points `path: charts/opencode-chat` at this repo,
  not a separate charts repo.
- The release workflow commits the new `imageTag` back into this same repo
  (`charts/opencode-chat/values.yaml`). That commit carries `[skip ci]` so it
  doesn't retrigger the CI workflow.

## Local dev

Five commands, Postgres in Docker, everything else on the host:

```sh
git clone <repo-url> && cd opencode-chat
cp .env.example .env   # fill in OPENCODE_API_KEY, GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET
npm install
docker compose -f docker-compose.dev.yml up -d \
  && DATABASE_URL=postgresql://app:app@localhost:5432/appdb \
  npx ts-node apps/api/src/db/run-migrations.ts   # postgres + schema
set -a && . .env && set +a && npm run dev   # api :3000, web :4200
```

Then open `http://localhost:4200`.

`.env.example` already defaults `COOKIE_SECURE=false` and
`APP_ORIGIN=http://localhost:4200` for local dev — leave those two as-is unless
you're testing against a deployed environment. Add
`http://localhost:4200/auth/google/callback` to the existing Google OAuth
client's authorized redirect URIs for local development.

`npm run dev` runs the api (`apps/api`, NestJS, port 3000 — fixed by
convention, nothing else should bind it) and the Angular dev server
(`apps/web`, port 4200) concurrently; the dev server proxies `/api` and
`/auth` to `http://localhost:3000` (`apps/web/proxy.conf.json`).

### Other useful commands

```sh
npm run build   # builds api then web
npm run lint    # lints both apps
npm run format  # prettier --write across apps/ and libs/
./run-tests.sh  # runs API tests against an ephemeral Postgres container
```

## Documentation

- [`docs/deployment.md`](docs/deployment.md) — secret creation, Google Cloud
  console setup, release/rollback procedure, secret refresh, GHCR visibility.
- [`docs/pre-deploy-checklist.md`](docs/pre-deploy-checklist.md) — the
  one-time manual steps required before the first real deploy (hostname, DNS,
  TLS, allowlist, platform prerequisites).

## Repo layout

```
opencode-chat/
├─ apps/
│  ├─ api/                  # NestJS 11, Express adapter
│  └─ web/                  # Angular 20, standalone components, signals
├─ libs/
│  └─ contracts/            # shared DTOs + SSE event types (source of truth)
├─ charts/opencode-chat/    # Helm chart
├─ argocd/opencode-chat.yaml
├─ k8s/                     # local kind cluster bootstrap
├─ docker/Dockerfile        # multi-stage, single runtime image
├─ .github/workflows/       # ci.yml, release.yml
├─ docker-compose.dev.yml   # postgres only, for local dev
└─ docs/                    # deployment + pre-deploy docs (this directory)
```
