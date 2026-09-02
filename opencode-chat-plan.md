# opencode-chat — build plan

A bare-bones, single-user (plus allowlist) chat web app that proxies prompts to
the OpenCode Go subscription. NestJS backend, Angular frontend, one monorepo
holding app code, Helm chart and Argo CD Application. Installed on iOS as a
home-screen web app.

Written to be executed by parallel sub-agents. Wave 0 is sequential and short;
everything after it is independent because the contracts are frozen up front.

---

## 1. Constraints

| Constraint | Consequence |
|---|---|
| Runs on a Hetzner CX23 (2 vCPU / 4 GB) beside existing workloads | Total request budget ≤ 400 Mi / 250 m. One app pod, no sidecars, no LiteLLM. |
| The OpenCode key is metered ($12/5h, $30/wk, $60/mo, shared with coding) | The key never leaves the backend. Hard allowlist on login + a per-user daily message cap. |
| Mobile chat, installed as PWA | Manifest with `display: standalone`, `scope` covering the app, redirect-based OAuth (no popups). |
| Bare bones | No attachments, no multi-user admin. Text in, streamed text out, history. |
| Web access (added after Wave 1 — see Wave 1.5) | Exactly two model-driven tools, `web_search` and `web_fetch`, under a frozen budget. No RAG, no vector store, no crawling. |

Deviation from the previous project: this is a **monorepo** (app + chart
together), not the app-repo/charts-repo split. That changes two things —
Argo CD points at a `charts/` path inside this repo, and the release workflow
commits the new `imageTag` back to the same repo, so the bump commit must
carry `[skip ci]` to avoid a build loop.

---

## 2. Repo layout

```
opencode-chat/
├─ apps/
│  ├─ api/                  # NestJS 11, Express adapter
│  │  └─ src/tools/         # web_search + web_fetch runtime (Wave 1.5)
│  └─ web/                  # Angular 20, standalone components, signals
├─ libs/
│  └─ contracts/            # shared DTOs + SSE event types (source of truth)
├─ charts/opencode-chat/    # Helm chart
├─ argocd/opencode-chat.yaml
├─ k8s/{cluster-up.sh,kind-config.yaml}  # local kind bootstrap (adapted from frameworks)
├─ docker/Dockerfile        # multi-stage, single runtime image
├─ .github/workflows/{ci.yml,release.yml}
├─ docker-compose.dev.yml   # postgres only, for local dev
└─ package.json             # npm workspaces
```

### Reuse from the existing repos

`lkroon/charts` and `lkroon/frameworks` already solve most of the platform
layer. Copy, don't re-derive:

| Need | Source | Notes |
|---|---|---|
| Local cluster bootstrap | `frameworks/k8s/cluster-up.sh` + `k8s/kind-config.yaml` | Idempotent: kind (host 80/443 → ingress), ingress-nginx, Argo CD (insecure, behind its own ingress) and the out-of-band secret from `.env`, then applies the Application. **Keep the metrics-server step** — Gate 2 checks `kubectl top pods` and Gate 3 checks `kubectl top nodes`, both of which need it. |
| Postgres StatefulSet | `charts/frameworks/templates/postgres.yaml` | Near-verbatim, minus the `db-init` ConfigMap and its checksum annotation. Change the `DATABASE_URL` in `db-credentials` from `postgresql+psycopg2://` (SQLAlchemy-only) to plain `postgresql://`. |
| Deployment shape | `charts/frameworks/templates/fastapi.yaml` | `envFrom.secretRef`, `revisionHistoryLimit: 1`, probe cadence, resources block, Downward API env. Drop the HPA, ServiceAccount, Role and RoleBinding — they exist for that project's replica-slider demo. |
| Argo CD Application | `charts/argocd/frameworks.yaml` | Same shape; change `repoURL`, `path: charts/opencode-chat`, namespace. |
| Tag → build → bump | `frameworks/.github/workflows/release.yaml` | Reuse the `sed` on `values.yaml` plus `Chart.yaml` `appVersion`, and the pull-rebase-retry push loop. Monorepo simplification: the default `GITHUB_TOKEN` can push to its own repo, so no `CHARTS_REPO_TOKEN` PAT — and pushes made with `GITHUB_TOKEN` do not trigger workflows, so `[skip ci]` is belt-and-braces rather than the thing preventing the loop. |
| Compose Postgres | `frameworks/docker-compose.yml` | The `db` service with its `pg_isready` healthcheck and `depends_on: condition: service_healthy`. |
| Integration-test harness | `frameworks/base/run_tests.sh` | Ephemeral docker network + `postgres:16` + wait-for-ready, torn down by a trap. Adapt the inner image from `python:3.12-slim`/`pip` to `node:22-alpine`/`npm ci`; C's "Done when" runs this, not the compose db. |
| Google OAuth | existing client; `GOOGLE_AUTH_ORIGIN` pattern in `frameworks/fastapi/app/auth.py` | Reuse confirmed. The registered origin today is `http://localhost`; a second redirect URI is purely additive. |
| `accounts` table | `frameworks/database/schema.sql` | `email` / `display_name` / `google_sub` already shaped as §4-C wants. Chatty gets its own database, so no collision. §4-C adds the chatty-only columns/tables around this. |
| Secret-refresh runbook | `frameworks/k8s/README.md` | The re-create-and-apply one-liner plus `rollout restart`. Workstream H copies it. |

---

## 3. Frozen contracts (Wave 0 output — nothing else starts until these exist)

Everything below lives in `libs/contracts`. Agents code against these types,
never against each other's implementations.

### HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/me` | `{ email, name, picture }` or 401 |
| `GET` | `/auth/google` | starts OAuth redirect |
| `GET` | `/auth/google/callback` | sets session cookie, 302 to `/` |
| `POST` | `/auth/logout` | clears session |
| `GET` | `/api/models` | `[{ id, label, family }]` |
| `GET` | `/api/conversations` | `[{ id, title, updatedAt }]` |
| `GET` | `/api/conversations/:id` | `{ id, title, messages: Message[] }` |
| `DELETE` | `/api/conversations/:id` | 204 |
| `POST` | `/api/chat` | SSE stream (below) |
| `GET` | `/healthz` `/readyz` | probes, unauthenticated |

### `POST /api/chat`

Request:
```ts
{ conversationId?: string; model: string; content: string }
```

Response: `text/event-stream`, `Cache-Control: no-cache`,
`X-Accel-Buffering: no`. Event names and payloads:

```ts
type ChatEvent =
  | { type: 'meta';  conversationId: string; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'thinking' }                 // Wave 1.5
  | { type: 'tool'; chip: ToolCallChip } // Wave 1.5
  | { type: 'done';  finishReason: string }
  | { type: 'error'; code: 'RATE_LIMIT'|'UPSTREAM'|'LIMIT_EXCEEDED'; message: string };
```

`thinking` and `tool` were added by Wave 1.5; their exact shapes and emission
rules are frozen in that section. A client that ignores both still renders a
correct transcript.

`meta` is always the first event, so the client can adopt the conversation id
for a brand-new chat before any text arrives.

### Data contracts (frozen)

These are the shapes the A↔C and A↔D seams depend on. Wave 0 emits the types;
nobody changes them mid-wave.

- **`DATABASE_URL`** is a plain node-postgres DSN: `postgresql://<user>:<password>@db:5432/<database>`.
  The chart builds it from `values.db.*` (see §4-G); the app never constructs it.
- **`messages` table** includes a nullable `finish_reason TEXT` column. A sets it
  to `'aborted'` when the client disconnects mid-stream (§4-A); it is `NULL` for
  completed messages. D does not render it.
- **`accounts` table** reuses the frameworks shape (`id, email, display_name,
  google_sub, …`) — see §4-C for the full column list.
- **`session` table** is owned by `connect-pg-simple` (§4-B), not hand-written:
  C creates it via `createTableIfMissing: true` in the store config, so no
  migration ships it.
- **Dev vs cluster db host**: dev (`docker-compose.dev.yml`, `npm run dev`) uses
  `postgresql://app:app@localhost:5432/appdb`; the cluster overrides the host to
  `db` via the `db-credentials` Secret. Same credentials, same db name, only the
  host differs — the app code never branches on environment.

### Environment variables

```
OPENCODE_API_KEY          # secret
OPENCODE_BASE_URL         # https://opencode.ai/zen/go/v1 — verified 2026-09-02, see §7
OPENCODE_MODELS           # csv of bare model ids, e.g. "glm-5.3,kimi-k3" — verified, see §7. Empty = /api/models serves only the cached upstream list.
GOOGLE_CLIENT_ID          # secret
GOOGLE_CLIENT_SECRET      # secret
SESSION_SECRET            # secret
APP_ORIGIN                # https://__CHAT_HOSTNAME__  (see §8) — callback is APP_ORIGIN + /auth/google/callback. No trailing slash.
ALLOWED_EMAILS            # csv of full addresses, case-insensitive exact match
DATABASE_URL              # postgresql://... (see Data contracts)
DAILY_MESSAGE_LIMIT       # int, default 200. With tools on, one message costs up to 4 upstream calls — see Wave 1.5.
COOKIE_SECURE             # bool, default true; false only for the plain-http local gate
PORT                      # 3000
WEB_SEARCH_ENABLED        # bool, default false. Off = Wave 1 behaviour exactly, no `tools` sent.
SEARCH_PROVIDER           # 'searxng' | 'brave', default 'searxng'. Unknown value fails at boot.
SEARXNG_BASE_URL          # e.g. http://searxng:8080 — required when SEARCH_PROVIDER=searxng. No trailing slash.
BRAVE_SEARCH_API_KEY      # secret; required when SEARCH_PROVIDER=brave, unused otherwise
TOOL_CAPABLE_MODELS       # csv of model ids allowed to receive a `tools` array, default "glm-5.3"
```

`APP_ORIGIN` and `COOKIE_SECURE` are non-secret chart `env` values; everything
tagged `secret` ships in the out-of-band `opencode-chat-auth` Secret. `PORT` is
fixed at 3000 by the chart and the Dockerfile; nothing else sets it.

Secrets follow the existing pattern: a Kubernetes Secret named
`opencode-chat-auth`, created out-of-band, consumed via `envFrom.secretRef`
and deliberately not templated into the chart. Required keys, exactly:
`OPENCODE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET`, plus `BRAVE_SEARCH_API_KEY` when `SEARCH_PROVIDER=brave`
(omit the key entirely for `searxng` — `envFrom` tolerates its absence, the
provider adapter does not). (The frameworks `.env` carries only the Google pair +
`SESSION_SECRET`; chatty's `.env` adds `OPENCODE_API_KEY`.) `DATABASE_URL` is
not in this Secret — it comes from the chart-managed `db-credentials` Secret
(§4-G), same as frameworks.

---

## 4. Workstreams

Each agent owns the listed paths exclusively. No two agents write the same file.

### Wave 0 — scaffold (sequential, one agent, ~30 min)

**Owns:** repo root, `libs/contracts/**`, `apps/web/proxy.conf.json`, `package.json`, tsconfig base, eslint/prettier, empty app skeletons.

- npm workspaces; `apps/api` via Nest CLI, `apps/web` via Angular CLI (standalone, no zone.js, SCSS).
- `libs/contracts` published as a path alias `@contracts/*` to both apps.
- **Path-alias strategy, frozen here:** the web (Angular CLI/esbuild) resolves
  `@contracts/*` from `tsconfig` paths alone. The api is compiled by `tsc`,
  which does **not** rewrite import specifiers — so add `tsc-alias` as an api
  devDependency and run it as a postbuild step (`tsc && tsc-alias -p
  tsconfig.build.json`). The runtime image then runs plain `node dist/main.js`
  with no `tsconfig-paths` shim and no `tsconfig.json` shipped. This is the
  decision F's Dockerfile builds against; do not revisit it in Wave 1.
- All types from §3, including the Data contracts. Models come from the
  `OPENCODE_MODELS` csv at runtime, not from a hardcoded constant — see §7.
  Contracts export the `Model` type and the csv parser, nothing else.
- **Emit the wiring files, so no Wave 1 agent has to touch them.** Everything
  below is written once here and is off-limits afterwards:
  - `apps/api/src/app.module.ts` importing `AuthModule`, `DbModule`,
    `ConversationsModule`, `ChatModule`, `OpencodeModule` and
    `ServeStaticModule`, each backed by an empty stub module in the directory
    its Wave 1 owner will fill. `ServeStaticModule.forRoot({ rootPath:
    join(__dirname, '..', 'public'), exclude: ['/api/{*splat}', '/auth/{*splat}'] })`
    — the Angular build is copied to `apps/api/public` in the Docker image
    (F's Dockerfile does the copy); the exclude keeps `/api` and `/auth` on the
    Nest router. ServeStatic must be registered **last** so its SPA fallback
    does not shadow the API routes.
  - `apps/api/src/main.ts` complete: `app.set('trust proxy', 1)` **before**
    session middleware, `express-session` wired to the default `MemoryStore` with a
    marked `// AUTH-STORE` seam at that line (B replaces the store with the
    Postgres one there — the single Wave 1 exception to "wiring files are
    off-limits"), global guard
    registration, `/healthz` and `/readyz`. **Do not call
    `app.use(compression())`** anywhere — compression buffers SSE and Gate 2
    will fail; there is no legitimate reason to enable it in v1. Global API
    prefix `/api` set here (`app.setGlobalPrefix('api', { exclude: ['healthz',
    'readyz'] })`) so controllers stay unprefixed and the auth routes (no
    prefix) live outside it.
  - `apps/web/src/app/app.config.ts` and `app.routes.ts` with routes for the
    chat and login shells, pointing at stub components in D's and E's
    directories.
  - The `UsageService` interface from the A↔C contract below.
- **Ports, frozen:** api listens on `PORT` (3000); the Angular dev server runs
  on 4200 and proxies `/api` and `/auth` to `http://localhost:3000`
  (`apps/web/proxy.conf.json`, registered under `serve.options.proxyConfig` in
  `angular.json`). Nothing else binds 3000/4200 in dev.
- **A↔C interface** in `libs/contracts`: C implements, A calls.
  `consume(accountId: string): Promise<{ ok: true } | { ok: false; reason: 'LIMIT_EXCEEDED' }>`
  — one atomic increment-and-check, no read-then-write. A must not reach into
  C's tables and C must not know about SSE.
- **A↔B seam, frozen:** after login B stores `accountId` on the session as
  `req.session.accountId` (a string). A reads it from the session inside the
  chat controller to key `consume(accountId)`. B owns writing it; A only reads.
- `npm run dev` runs both with the Angular dev-server proxying `/api` and `/auth` to `:3000`.
- Commit and push. **Every later wave branches from this commit.**

### Wave 1 — eight agents in parallel

---

**A. OpenCode proxy (backend)**
**Owns:** `apps/api/src/chat/**`, `apps/api/src/opencode/**`

- `OpencodeClient` (inside `chat/`, not a separate transport — but behind a
  narrow class interface, see §7): POST to `${OPENCODE_BASE_URL}/chat/completions`
  with `stream: true`, `Authorization: Bearer $OPENCODE_API_KEY`, body
  `{ model, messages: [...history, { role: 'user', content }] }` built from C's
  stored messages. (Wave 1.5 adds an optional `tools` array to this body; the
  request shape is otherwise unchanged.) Model ids are bare (`glm-5.3`), not `opencode-go/glm-5.3` —
  that prefix is OpenCode-TUI syntax. Uses `fetch` (Node 22 global), not a
  third-party http client.
- Frame our SSE as `event: <type>` + `data: <json>\n\n` per the §3 event names.
  Parse the upstream SSE, re-emit as the `ChatEvent` shape; do not pipe the
  upstream stream through verbatim — the wire format must stay ours. Split
  chunks on `\n\n` and buffer the remainder, because a chunk can end
  mid-`data:` line (see the fixture test below).
- Usage gate: call `UsageService.consume(accountId)` (the Wave 0 seam) as the
  **first** statement of the chat handler, before opening the upstream stream.
  On `{ ok: false }` emit `{ type: 'error', code: 'LIMIT_EXCEEDED' }` and close.
  On `{ ok: true }` persist the user message via C, then stream. `accountId`
  comes from `req.session.accountId` (the A↔B seam from Wave 0).
- Abort handling: if the client disconnects (`res.on('close')`), abort the
  upstream request via an `AbortController` so you stop paying for tokens
  nobody will read.
- **On abort, persist what streamed.** The user message and the partial
  assistant message are both written, the assistant row flagged
  `finish_reason: 'aborted'` (§3 Data contracts — the column exists). Discarding
  it would make Wave 2's "reload → history intact" check meaningless for
  exactly the case most likely to happen on mobile — a locked screen mid-stream.
  The usage counter is not refunded (§4-C).
- Map upstream 429 → `error: RATE_LIMIT`, 5xx → `error: UPSTREAM`. Any other
  non-2xx without a body → `UPSTREAM` with the status in `message`.
- `GET /api/models`: fetch `${OPENCODE_BASE_URL}/models` at boot, cache in
  memory, refresh never (restart-only, §7). On fetch failure serve the
  `OPENCODE_MODELS` csv fallback; an empty csv means upstream-or-nothing (§3).
  Label defaults to the id — no hardcoded label map for ids that may not exist.
- Unit-test the SSE parser against recorded fixtures: one chunk split
  mid-`data:` line, one ending exactly on `\n\n`, one carrying multiple events
  in a single chunk. The split-mid-line case is the bug that always bites.

**Done when:** `curl -N` against a fake upstream yields correct framing
(`event:`/`data:` lines), and `npm run test -w api` is green, including the SSE
parser fixture test that splits a chunk mid-`data:` line.

---

**B. Auth (backend)**
**Owns:** `apps/api/src/auth/**`, session config in `main.ts` bootstrap section

- `passport-google-oauth20`, redirect flow only. Callback `APP_ORIGIN + /auth/google/callback`.
- Session cookie: `httpOnly`, `sameSite: 'lax'`, 30-day rolling (`maxAge:
  30 * 24 * 60 * 60 * 1000`), `secure` from `COOKIE_SECURE`, name
  `opencode-chat.sid`. Store in Postgres via `connect-pg-simple` with
  `createTableIfMissing: true` (§3 Data contracts — no migration ships the
  `session` table) so a pod restart doesn't log you out. Use the default table
  name `session`; do not rename it.
- Replace the store at the marked `// AUTH-STORE` seam in `main.ts` — the one
  authorized Wave 1 edit to a wiring file. Everything else about session config
  stays as Wave 0 wrote it.
- `app.set('trust proxy', 1)` — already in Wave 0's `main.ts`, do not move it.
  Behind the ingress the app sees plain http; without this Express refuses to
  set a `secure` cookie and login silently never sticks. This is the
  second-most-likely first-deploy failure after `redirect_uri_mismatch`.
- `ALLOWED_EMAILS` check inside the verify callback — reject before creating a
  session, not in a later guard. Match case-insensitively on the full address
  (§3); a non-match fails the strategy (redirect to `/login`, no session), it
  does not 500.
- Global `AuthGuard` on the `/api` prefix except `/healthz`, `/readyz` (Wave 0
  set the prefix with those two excluded; B only supplies the guard class).
  Guard reads `req.session.accountId` (the A↔B seam).
- Upsert into `accounts` on first login (`email`, `google_sub`, `display_name`),
  mirroring `frameworks/fastapi/app/auth.py` — match on `google_sub` first,
  fall back to `email`, then insert.

**Done when:** unauthenticated `/api/models` gives 401; an allowlisted login round-trip yields a working `/api/auth/me`.

---

**C. Persistence (backend)**
**Owns:** `apps/api/src/db/**`, `apps/api/src/conversations/**`, migrations

- **Pick one: Drizzle.** It is lighter than TypeORM and its SQL is closer to
  what the `INSERT ... ON CONFLICT` below needs; do not spend a wave comparing.
  Note the choice in the README. Over Postgres 16.
- Tables (`snake_case` throughout; `accounts` shape from
  `frameworks/database/schema.sql`):
  - `accounts(id serial pk, email text unique not null, display_name text,
    google_sub text unique, provider text not null default 'google')`
  - `conversations(id uuid pk default gen_random_uuid(), account_id int
    references accounts, title text, model text, created_at timestamptz
    default now(), updated_at timestamptz default now())`
  - `messages(id uuid pk default gen_random_uuid(), conversation_id uuid
    references conversations on delete cascade, role text check (role in
    ('user','assistant')), content text, model text, finish_reason text,
    created_at timestamptz default now())` — `finish_reason` is the §3 Data
    contract A writes `'aborted'` into; nullable, `NULL` when complete.
  - `usage_counters(account_id int references accounts, day date,
    message_count int, primary key (account_id, day))`
- Title = first 60 chars of the first user message. No LLM-generated titles.
- Migrations run as G's Helm hook Job (§4-G settles the phase), not on app boot
  — app boot must stay fast for probes. Use Drizzle's migrator (`drizzle-kit
  migrate`) in the Job image; the Job uses the same image as the app.
- `DAILY_MESSAGE_LIMIT` enforcement: implement `UsageService.consume` from the
  Wave 0 contract as a single atomic statement, no read-then-write — two tabs
  sending at once must not both pass:

  ```sql
  INSERT INTO usage_counters (account_id, day, message_count)
  VALUES ($1, CURRENT_DATE, 1)
  ON CONFLICT (account_id, day)
  DO UPDATE SET message_count = usage_counters.message_count + 1
  RETURNING message_count;
  ```
  …then check `message_count <= limit` on the returned row. A consumes before
  the upstream stream opens (§4-A); if the check fails A gets
  `{ ok: false, reason: 'LIMIT_EXCEEDED' }`.
- Counters are consumed on send and never refunded, including on abort. Simpler
  than reconciling, and it fails in the safe direction for a metered key.

**Done when:** migrations apply to an empty DB and a repository integration
test passes via the ephemeral harness (`chatty/run-tests.sh`, adapted from
`frameworks/base/run_tests.sh`; the harness itself is F's, C's test just runs
under it).

---

**D. Chat UI (frontend)**
**Owns:** `apps/web/src/app/chat/**`, `apps/web/src/app/core/**`

- Streaming client uses `fetch` + `ReadableStream` reader, **not** `EventSource`
  — the request is a POST with a body and EventSource can't do that. On
  `401`/`403` from `/api/*` redirect to E's `/login` route (the A↔E seam).
- Signal-based store: conversation list, active conversation, streaming buffer.
  Append deltas to a signal; render with `@for` over messages.
- Markdown rendering with `marked` + `DOMPurify`. Code blocks get a copy button.
  No syntax-highlighting library — it's the biggest bundle item for the least value here.
- Model picker in the header, persisted to `localStorage` under the key
  `oc-model`; when the stored id is no longer in `/api/models`, fall back to
  the first model in the list rather than sending a stale id.
- Works against a stubbed backend (hand-written SSE mock in a `*.mock.ts` under
  `chat/`) so this agent never blocks on A. The mock is deleted in Wave 2.

**Done when:** the mock stream renders progressively, history navigation works, and the bundle is under 500 kB gzipped.

---

**E. Shell, PWA, mobile (frontend)**
**Owns:** `apps/web/src/app/layout/**`, `apps/web/src/manifest.webmanifest`, `apps/web/public/icons/**`, `index.html`, global SCSS

- Manifest: `display: standalone`, `scope: "/"`, `start_url: "/"`, theme colour,
  180×180 `apple-touch-icon` plus 192/512 maskable PNGs. The `.webmanifest`
  extension matters for the Angular CLI; name the file
  `manifest.webmanifest` and reference it in `index.html`.
- `@angular/pwa` service worker in `freshness` mode for `/api`, `performance`
  for assets. Never cache `/auth/*` — an OAuth callback cached by the SW is a
  silent login loop.
- Safe-area insets (`env(safe-area-inset-bottom)`) on the composer — without
  this the input sits under the home indicator.
- Composer: textarea that grows to ~5 lines, Enter sends on desktop, newline on
  mobile with an explicit send button.
- Login screen at route `/login` (the A↔E seam D redirects to on 401). One
  "Sign in with Google" button linking to `/auth/google`; no form — there is no
  local auth in this app.

**Done when:** installed to an iOS home screen it launches with no browser chrome and the composer clears the home indicator.

---

**F. Container + CI**
**Owns:** `docker/Dockerfile`, `.dockerignore`, `.github/workflows/**`, `docker-compose.dev.yml`

- Multi-stage: `node:22-alpine` build → `npm ci` → build web → build api →
  runtime stage with production deps only, `node dist/main.js`, non-root user.
  The web build output is copied into `apps/api/public` at build time —
  ServeStatic serves from there (Wave 0 froze the rootPath; this is the copy
  that makes it real). `.dockerignore` excludes `node_modules`, `.git`,
  `charts/`, and `argocd/`.
  Nest serves the Angular build from `/` via `ServeStaticModule` with an
  SPA fallback that excludes `/api` and `/auth`.
- Target: image under 250 MB, cold start under 5 s.
- `ci.yml`: lint + test + build on PR.
- `release.yml`: on `v*` tag, build and push `ghcr.io/lkroon/opencode-chat:<tag>`,
  then commit the new `imageTag` into `charts/opencode-chat/values.yaml` with
  `[skip ci]` in the message. **Workflow permissions must be
  `contents: write, packages: write`** — the monorepo bump job pushes to its
  own repo with the default `GITHUB_TOKEN` (no `CHARTS_REPO_TOKEN` PAT), and
  `contents: read` would reject that push. The `[skip ci]` plus the
  `GITHUB_TOKEN`-does-not-retrigger rule are belt-and-braces (§2).

**Done when:** `docker build` succeeds, `docker run` with a `.env` answers both
probes 200, and the image is under 250 MB. The static-serving half of this —
that the container actually serves the Angular app — cannot be checked in Wave 1
because it needs D's and E's build output. It is a Gate 1 check, not F's.

---

**G. Helm chart + Argo CD**
**Owns:** `charts/opencode-chat/**`, `argocd/opencode-chat.yaml`, `k8s/**`

Adapt from the existing `frameworks` chart — same conventions, smaller.

- `deployment.yaml`: `replicas: 1` set explicitly (the source omits it because
  its HPA owns the count — here there is no HPA), `envFrom` the out-of-band
  `opencode-chat-auth` Secret, `env` for the non-secret settings
  (`APP_ORIGIN`, `COOKIE_SECURE`, `ALLOWED_EMAILS`, `DAILY_MESSAGE_LIMIT`,
  `OPENCODE_BASE_URL`, `OPENCODE_MODELS`, and from Wave 1.5
  `WEB_SEARCH_ENABLED`, `SEARCH_PROVIDER`, `SEARXNG_BASE_URL`,
  `TOOL_CAPABLE_MODELS` — all chart values, not secrets;
  `BRAVE_SEARCH_API_KEY` is a secret and arrives via `envFrom`),
  probes on `/healthz` and `/readyz`, `revisionHistoryLimit: 1`.
- `postgres.yaml`: StatefulSet + `db-credentials` Secret + 1 Gi PVC, copied from
  the previous chart with the init ConfigMap dropped (migrations handle schema).
- `ingress.yaml`: `nginx` class, single host from `values.ingress.host`,
  `nginx.ingress.kubernetes.io/proxy-read-timeout: "600"` and
  `proxy-buffering: "off"` — **without these the SSE stream arrives in one lump
  at the end.** Render a `tls:` block conditionally from values
  (`ingress.tls.enabled` + `ingress.tls.secretName`, or a
  `ingress.tls.clusterIssuer` annotation if cert-manager lands) so the §8.7
  decision is a values flip, not a later template edit.
- `migrate-job.yaml`: **not** `pre-install`. Argo CD maps `pre-install`/`pre-upgrade`
  to `PreSync`, which runs before the Postgres StatefulSet is created — on a fresh
  cluster the migration Job has nothing to connect to, fails, and takes the first
  sync down with it. Use `helm.sh/hook: post-install,pre-upgrade`, and regardless
  of hook phase give the Job an init container that blocks on `pg_isready` plus a
  `backoffLimit` and `activeDeadlineSeconds` so a wedged migration fails loudly
  instead of hanging the sync. Set `argocd.argoproj.io/hook-delete-policy:
  BeforeHookCreation` alongside the Helm annotation — verify which one Argo CD
  actually honours on this version rather than assuming.
- `argocd/opencode-chat.yaml`: same shape as the previous Application, `path: charts/opencode-chat`, automated sync with prune and selfHeal.

Resource budget:

| Container | requests | limits |
|---|---|---|
| api | 100 m / 192 Mi | 500 m / 384 Mi |
| postgres | 100 m / 256 Mi | — / 384 Mi |

(The postgres request memory tracks the frameworks source's 256 Mi, not the
api's 192 Mi — the source measured it.)

That is chatty alone. Budget the node, not the app: a stock Argo CD install is
roughly 1 Gi before anything it deploys, ingress-nginx another ~100 Mi, and if
`frameworks` lands on the same box it requests a further 200 m / 384 Mi. On a
4 GB CX23 that leaves little headroom, and the Postgres StatefulSet cannot be
evicted without losing the PVC binding. Confirm with `kubectl top nodes` at
Gate 3 before assuming it fits; if it does not, `frameworks` and chatty do not
belong on the same node.

**Done when:** `helm template` renders clean, `helm lint` passes, and `kubeconform` validates the output.

---

**H. Docs**
**Owns:** `README.md`, `docs/**`

- Local dev in five commands.
- Secret creation runbook (`kubectl create secret generic opencode-chat-auth --from-env-file=.env`).
- Google Cloud console steps for the redirect URI.
- Release/rollback procedure — and state plainly that it is one-way for schema.
  Migrations run pre-upgrade, `revisionHistoryLimit: 1`, and Argo CD self-heals,
  so reverting `imageTag` rolls the code back and leaves the new schema in
  place. Any migration that drops or narrows a column must therefore be split
  across two releases (add and backfill, then a later release removes the old
  path) or it is not rollable at all.
- The secret-refresh one-liner from `frameworks/k8s/README.md`, and the note that
  Argo CD self-heal reverts anything applied to the namespace by hand.
- **GHCR visibility**: document the §8 step — the package is private by default
  and the first Argo CD sync will `ImagePullBackOff` until it is public (or
  `imagePullSecrets` are added). One-time, manual, not automatable from CI.
- **Hostname checklist**: the §8 manual steps as a pre-deploy checklist
  (subdomain, DNS, Google redirect URI, Secret, `ALLOWED_EMAILS`, one-time
  Application apply, TLS decision, platform prereqs).
- **Web search operations** (added with Wave 1.5): which provider is
  configured and how to switch; that a self-hosted SearXNG needs
  `formats: [html, json]` in its `settings.yml` or every search 403s; that
  `WEB_SEARCH_ENABLED=false` is the kill switch if the key starts burning;
  and — the one that surprises people — that with tools on, one user message
  costs up to four upstream calls, so `DAILY_MESSAGE_LIMIT` should be roughly
  a quarter of its tools-off value. Document the `messages.upstream_cost`
  column as the way to see what a conversation actually cost.

---

### Wave 1.5 — web search (three agents, after Wave 1 merges, before Gate 1)

Bare-bones chat with no access to the live web turned out to be too limited to
use, so v1 gains exactly two tools — `web_search` and `web_fetch` — driven by
the model's own tool calling. This is a deliberate reversal of §1's "no tool
calling" and §1's "no RAG"; everything else in that row still holds (no
attachments, no multi-user admin).

This wave lands **before Gate 1**, and Gate 1 runs once against the combined
result. Nothing here touches the chart, the Dockerfile or CI beyond adding
values and env vars, so Gate 2 and Gate 3 are unchanged in shape.

#### Verified upstream facts — probed against the live API on 2026-09-02

These were confirmed with the real key against
`https://opencode.ai/zen/go/v1`. Do not re-derive them, and do not "fix" the
code to some other shape on the assumption that this is still unverified —
§7's old "base URL and model ids are unverified" caveat is now closed.

- `GET /models` → 200. Available ids include `glm-5.3`, `glm-5.3-flash`,
  `glm-5.2`, `kimi-k3`, `kimi-k2.7-code`, `minimax-m3`, `deepseek-v4-pro`,
  `deepseek-v4-flash`, `qwen3.8-max`, `longcat-2.0`. The base URL and the
  bare-id format the plan guessed from memory were both correct.
- `POST /chat/completions` **accepts a top-level `tools` array** in the
  OpenAI function-calling format, and `glm-5.3` calls them. Non-streaming
  reply carries `choices[0].finish_reason: "tool_calls"` and
  `choices[0].message.tool_calls[]`.
- **Streaming tool calls are incremental and must be reassembled by
  `index`.** The first frame for a call carries `index`, `id`, `type` and
  `function.name` with `function.arguments: ""`; every later frame carries
  only `index` plus a fragment of `function.arguments`, which you
  concatenate in arrival order. Observed frames, trimmed:

  ```
  {"choices":[{"index":0,"finish_reason":null,"delta":{"tool_calls":[{"index":0,"id":"chatcmpl-tool-9454…","type":"function","function":{"name":"web_search","arguments":""}}]}}]}
  {"choices":[{"index":0,"finish_reason":null,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\": \""}}]}}]}
  {"choices":[{"index":0,"finish_reason":null,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"H"}}]}}]}
  {"choices":[{"index":0,"finish_reason":"tool_calls","delta":{}}]}
  ```

  The accumulated `arguments` string is JSON and is only parseable once the
  round ends. Never `JSON.parse` a fragment.
- **`delta.reasoning_content` exists** and carried 24 of 38 frames in the
  probe. It is the model's chain of thought, it is not `delta.content`, and
  it must never be rendered as assistant text or persisted. It is the reason
  a user can stare at a dead stream for several seconds before the first
  visible token.
- **Frames arrive after `data: [DONE]`.** The observed tail is a usage frame
  with `"choices":[]`, then `data: [DONE]`, then `data: {"choices":[],"cost":"0"}`.
  A completion therefore signals its end **twice**: once via a
  `finish_reason` frame and once via `[DONE]`.
- The trailing frame carries `cost` as a **string** (`"0"` on the probe),
  which is the only per-request billing figure the upstream gives.

#### Budget — frozen, not per-agent judgement

A tool loop re-sends the whole message array on every round, so injected text
is paid for once per remaining round. These caps are the difference between a
few cents and a few dollars per question on a metered key. They live as
exported constants in `apps/api/src/tools/tool-budget.ts`, not as env vars —
they are not operator knobs.

| Constant | Value | Meaning |
|---|---|---|
| `MAX_TOOL_ROUNDS` | 3 | Upstream calls that may request tools. Round 4 is sent with no `tools` param, so the model must answer. |
| `SEARCH_MAX_RESULTS` | 5 | Results per `web_search` call — title, url, snippet only. Never full pages. |
| `MAX_FETCHES_PER_EXCHANGE` | 2 | Total `web_fetch` calls across all rounds of one user message. |
| `FETCH_MAX_CHARS` | 8000 | Hard truncation of one fetched page's extracted text. |
| `TOOL_TOTAL_MAX_CHARS` | 20000 | Total tool output injected across the whole exchange. The real ceiling. |
| `SEARCH_TIMEOUT_MS` | 5000 | Per search request. |
| `FETCH_TIMEOUT_MS` | 8000 | Per page fetch, including redirects. |
| `FETCH_MAX_BYTES` | 2097152 | 2 MiB read cap; abort the body beyond it. |

**Usage accounting stays as it is.** `UsageService.consume()` is still called
exactly once per user message — the A↔C contract does not change. The
consequence, which H documents: with tools enabled one "message" costs up to
four upstream calls, so an operator should set `DAILY_MESSAGE_LIMIT` to about
a quarter of what they would set with tools off. Do not add a second
`consume()` call inside the loop; a mid-loop limit failure would strand an
exchange with tool results and no answer.

**Tool results are ephemeral.** They exist inside the exchange that created
them and are never written to `messages`. Round 2 sees them; tomorrow's
message in the same conversation does not. Persisting them would re-send
yesterday's search output on every future turn forever. What survives is the
assistant's answer text plus the chips (below) — `messages.role` therefore
keeps its `check (role in ('user','assistant'))` constraint untouched, and
no `'tool'` role is ever stored.

#### Frozen interfaces — written once, then off-limits

Same rule as Wave 0 §5: an agent that needs one of these changed stops and
raises it rather than editing it.

**1. Contracts** (`libs/contracts/src/chat.ts`, `libs/contracts/src/conversation.ts`).
Agent K writes these verbatim before J or L start:

```ts
export type ToolName = 'web_search' | 'web_fetch';

/** A source the assistant actually consulted. Rendered as a link. */
export interface ToolSource {
  title: string;
  url: string;
}

/** One tool invocation, as shown in the transcript. Never carries page text. */
export interface ToolCallChip {
  callId: string;
  name: ToolName;
  status: 'running' | 'done' | 'failed';
  /** Human line, e.g. `Searched "hacker news top story"` or `Read nginx.org`. */
  label: string;
  sources: ToolSource[];
}

export type ChatEvent =
  | { type: 'meta'; conversationId: string; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'thinking' }
  | { type: 'tool'; chip: ToolCallChip }
  | { type: 'done'; finishReason: string }
  | {
      type: 'error';
      code: 'RATE_LIMIT' | 'UPSTREAM' | 'LIMIT_EXCEEDED';
      message: string;
    };
```

`Message` (in `conversation.ts`) gains one optional field, so stored
transcripts can re-render their chips:

```ts
  toolCalls?: ToolCallChip[];
```

No new `error` code. A tool that fails, times out or runs out of budget is
**not** an exchange-level error: it returns its failure to the model as tool
output and the model writes its way around it.

`thinking` is emitted **at most once per upstream round**, on the first frame
carrying `delta.reasoning_content`. It carries no text — the chain of thought
is never sent to the browser.

`tool` events are emitted twice per call: once with `status: 'running'` when
execution starts, once with `status: 'done' | 'failed'` when it ends. Both
carry the same `callId`, which is the upstream's `tool_calls[].id`. The web
client keys on `callId` and replaces in place.

**2. `ToolRuntime`** (`apps/api/src/tools/tool-runtime.ts`) — J implements, K calls:

```ts
export interface ToolDefinition {
  type: 'function';
  function: { name: ToolName; description: string; parameters: object };
}

export interface ToolExecutionResult {
  /** Exactly what goes back to the model as the `tool` message content. Already truncated. */
  content: string;
  /** Human line for the chip. */
  label: string;
  sources: ToolSource[];
  status: 'done' | 'failed';
}

export interface ToolRuntime {
  /** The `tools` array sent upstream. Stable across a process's lifetime. */
  definitions(): ToolDefinition[];
  execute(
    call: { name: string; rawArguments: string },
    budget: ToolBudget,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult>;
}

export const TOOL_RUNTIME = 'TOOL_RUNTIME';
```

`execute` **never throws**. Every failure path — unknown tool name,
unparseable arguments, provider down, timeout, blocked URL, budget exhausted —
returns `status: 'failed'` with a `content` string the model can read, e.g.
`Search failed: provider unreachable. Answer from your own knowledge and say
the lookup failed.` K treats a thrown error from `execute` as a bug, logs it,
and converts it to the same shape rather than failing the exchange.

**3. `ToolBudget`** (`apps/api/src/tools/tool-budget.ts`) — J owns the class,
K constructs exactly one per exchange and passes the same instance to every
`execute` call:

```ts
export class ToolBudget {
  fetchesRemaining = MAX_FETCHES_PER_EXCHANGE;
  charsRemaining = TOOL_TOTAL_MAX_CHARS;
  /** Decrements and returns false when exhausted. J calls this, not K. */
  claimFetch(): boolean;
  /** Truncates `text` to what remains, decrements, returns what may be used. */
  claimChars(text: string): string;
}
```

**4. `ConversationStore` addition** (`apps/api/src/chat/conversation-store.ts`,
K owns the interface; L implements it in `conversations/`) — mirrors the
existing A↔C seam exactly:

```ts
  /**
   * Persists the chips for one assistant message. Called once, from the
   * `finally` of an exchange, after finalizeAssistantMessage. Chips with
   * status 'running' are stored as 'failed' — a running chip means the
   * process died mid-call.
   */
  saveToolCalls(input: {
    assistantMessageId: string;
    chips: ToolCallChip[];
  }): Promise<void>;
```

---

**J. Tool runtime (backend)**
**Owns:** `apps/api/src/tools/**`

Everything in this workstream is pure — no Nest request scope, no database, no
knowledge that SSE exists.

- **`tool-definitions.ts`** — the exact JSON schemas sent upstream. Frozen:

  ```ts
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web and return the top results as title, URL and snippet. Use for anything current, or when asked to look something up. Returns snippets only, not full pages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
        },
        required: ['query'],
      },
    },
  }
  ```

  ```ts
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch one web page and return its readable text, truncated. Only use on URLs the user supplied or that web_search returned. Never guess a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL.' },
        },
        required: ['url'],
      },
    },
  }
  ```

- **`search-provider.ts`** — one narrow interface, two adapters selected by
  `SEARCH_PROVIDER`. Both return at most `SEARCH_MAX_RESULTS` of
  `{ title, url, snippet }`.

  - `searxng` (default; no API key, for local dev and self-hosting):
    `GET ${SEARXNG_BASE_URL}/search?q=<q>&format=json&language=en&safesearch=0`.
    Results are in `.results[]` as `{ title, url, content }` — map `content`
    to `snippet`. **A stock SearXNG only serves HTML**; `formats: [html, json]`
    must be enabled in its `settings.yml` or every call 403s. H documents this.
  - `brave` (hosted, for the cluster):
    `GET https://api.search.brave.com/res/v1/web/search?q=<q>&count=5`
    with headers `X-Subscription-Token: ${BRAVE_SEARCH_API_KEY}` and
    `Accept: application/json`. Results are in `.web.results[]` as
    `{ title, url, description }` — map `description` to `snippet`.

  An unknown `SEARCH_PROVIDER` value fails **at boot**, not at first search.

- **Search result formatting** — what the model actually receives, frozen so
  the two providers are indistinguishable downstream:

  ```
  1. <title>
  <url>
  <snippet>

  2. <title>
  ...
  ```

  Zero results yields the literal string
  `No results. Tell the user the search found nothing rather than inventing an answer.`

- **`web-fetch.ts`** — fetch, guard, extract, truncate.

  - **SSRF guard, `url-guard.ts`, non-negotiable.** This pod sits on a cluster
    network next to Postgres, Argo CD and the kubelet; an unguarded fetch tool
    is a request-forgery primitive that the model can be talked into aiming
    anywhere. Reject, before any socket opens:
    - any scheme other than `http:` or `https:`;
    - any URL with credentials (`user:pass@`);
    - any hostname resolving — via `dns.promises.lookup(host, { all: true })`,
      checking **every** returned address — into: `0.0.0.0/8`, `10/8`,
      `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`,
      `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`,
      `203.0.113/24`, `224/4`, `240/4`, `255.255.255.255/32`; and for IPv6
      `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`,
      `2001:db8::/32`, plus any `::ffff:0:0/96` mapped address whose embedded
      IPv4 hits the list above.
    - Re-run the check **on every redirect hop**, cap redirects at 3, and
      re-validate the final URL. A 302 to `169.254.169.254` is the whole
      attack.
    - Send no cookies, no `Authorization`, and a fixed
      `User-Agent: opencode-chat/1.0 (+https://__CHAT_HOSTNAME__)`.
    - Accept only `text/html`, `application/xhtml+xml`, `text/plain`,
      `text/markdown`, `application/json`; anything else returns a `failed`
      result naming the content type.
    - Abort past `FETCH_MAX_BYTES` while reading, not after.
  - **Extraction** — no `jsdom`, no `@mozilla/readability`. The pod's whole
    memory limit is 384 Mi and a headless DOM will not fit beside Nest and
    Postgres client pools. Use `cheerio`: drop `script`, `style`, `noscript`,
    `svg`, `nav`, `header`, `footer`, `form`, `iframe`; then take the text of
    the first match of `article`, else `main`, else `[role=main]`, else
    `body`; collapse runs of whitespace to single spaces and runs of blank
    lines to one. Prepend the page `<title>` and the final URL as the first
    two lines. Truncate to `FETCH_MAX_CHARS` on a word boundary and append
    `\n\n[truncated]`. `application/json` and `text/plain` skip cheerio and
    truncate directly.
  - Chip labels: `Read <hostname>` on success, `Couldn't read <hostname>` on
    failure. Never put the full URL in the label — it wrecks the layout on a
    phone. The URL goes in `sources`.

- **`tool-runtime.impl.ts`** — dispatch on name, parse `rawArguments` with a
  guarded `JSON.parse`, enforce budget through the passed `ToolBudget`,
  return `ToolExecutionResult`. Budget-exhausted content, frozen:
  `Tool budget exhausted for this message. Answer with what you already have.`

**Tests (all offline — no live network in CI):**
- `url-guard.spec.ts`: a table of ~20 URLs, each asserted allowed or blocked,
  covering `http://localhost:5432`, `http://169.254.169.254/latest/meta-data/`,
  `http://[::1]/`, `http://127.0.0.1.nip.io/`, a public hostname stubbed to
  resolve to `10.0.0.5`, `file:///etc/passwd`, `http://user:pw@example.com`,
  and a normal `https://example.com/page`.
- `web-fetch.spec.ts` against a local `http.createServer` fixture (the same
  pattern `opencode-client.spec.ts` already uses): a redirect chain ending at
  a blocked IP is refused; an oversized body is aborted; a
  `Content-Type: application/pdf` is refused; a real HTML page extracts to the
  expected text with nav and script stripped.
- `search-provider.spec.ts`: both adapters against recorded JSON fixtures,
  including a zero-result response and a 5xx.
- `tool-budget.spec.ts`: `claimChars` truncates at the boundary; the third
  `claimFetch` returns false.

**Done when:** `npm run test -w apps/api` is green and no test in this
workstream opens a socket to anything but 127.0.0.1.

---

**K. Agent loop and streaming tool calls (backend)**
**Owns:** `apps/api/src/opencode/**`, `apps/api/src/chat/**`, `libs/contracts/src/**`

- **Write the frozen contracts above first and push them**, so J and L are
  unblocked. Then everything below.

- **`opencode-client.ts` — accumulate tool calls.** `parseFrameData` currently
  reads only `delta.content` and `finish_reason` and drops everything else.
  Extend `OpencodeStreamChunk`:

  ```ts
  export type OpencodeStreamChunk =
    | { type: 'delta'; text: string }
    | { type: 'reasoning' }
    | { type: 'tool_call_fragment'; index: number; id?: string; name?: string; argumentsFragment?: string }
    | { type: 'done'; finishReason: string };
  ```

  Reassembly by `index` belongs to the **client**, not the service: expose
  the accumulated calls off the generator so the service never sees fragments.
  Concretely, `streamChatCompletion` keeps a `Map<number, { id, name, args }>`
  and yields a final `{ type: 'done', finishReason, toolCalls }` — extend the
  `done` chunk with `toolCalls?: AccumulatedToolCall[]` rather than making the
  service reassemble.

- **Fix the double `done`.** A completion emits both a `finish_reason` frame
  and `[DONE]`, so today's client yields `done` twice and `ChatService` writes
  two `done` SSE events. Benign now; ambiguous under a loop. Rule: the first
  `done` for a round wins, `[DONE]` after a `finish_reason` is ignored, and a
  bare `[DONE]` with no preceding `finish_reason` still yields
  `{ finishReason: 'stop' }`. Frames after `[DONE]` are parsed only for
  `cost`.

- **Capture `cost`.** Parse the trailing `{"choices":[],"cost":"…"}` frame,
  sum it across rounds, and hand it to the store as a `number | null`
  (`Number(cost)`, `null` when absent or `NaN`). It is the only real spend
  signal on a metered key.

- **`chat.service.ts` — the bounded loop.** Replaces the current linear
  `for await`. Exact algorithm:

  ```
  budget = new ToolBudget()
  chips  = []
  rounds = 0
  messages = [systemPrompt, ...history]        # history from the store, unchanged

  loop:
    sendTools = toolsEnabled && modelIsToolCapable && rounds < MAX_TOOL_ROUNDS
    stream = opencode.streamChatCompletion({ model, messages, tools: sendTools ? runtime.definitions() : undefined, signal })

    roundText = ''; emittedThinking = false; finishReason = null; toolCalls = []
    for chunk of stream:
      if signal.aborted: aborted = true; break out of everything
      delta      -> roundText += text; accumulated += text; emit { type:'delta', text }
      reasoning  -> if !emittedThinking { emit { type:'thinking' }; emittedThinking = true }
      done       -> finishReason = chunk.finishReason; toolCalls = chunk.toolCalls ?? []

    if finishReason != 'tool_calls' || toolCalls.length == 0:
      emit { type:'done', finishReason: finishReason ?? 'stop' }
      break

    rounds += 1
    messages.push({ role:'assistant', content: roundText, tool_calls: <verbatim, as received> })

    for call of toolCalls (in index order):
      chip = { callId: call.id, name: call.name, status:'running', label: provisionalLabel(call), sources: [] }
      chips.push(chip); emit { type:'tool', chip }
      result = await runtime.execute({ name: call.name, rawArguments: call.args }, budget, signal)
      chip = { ...chip, status: result.status, label: result.label, sources: result.sources }
      replace in chips; emit { type:'tool', chip }
      messages.push({ role:'tool', tool_call_id: call.id, content: result.content })
  ```

  Notes that are not optional:
  - The assistant message carrying `tool_calls` must be echoed back
    **verbatim** in the shape the upstream sent (`id`, `type`, `function.name`,
    `function.arguments` as a string). A reconstructed-from-parsed-JSON
    version is a different string and some providers reject it.
  - Round `MAX_TOOL_ROUNDS + 1` is sent with **no** `tools` key at all — not
    `tool_choice: 'none'`, which is less widely supported.
  - `provisionalLabel` for the running chip: `Searching…` / `Reading…`. The
    real label arrives with the result. Do not parse `rawArguments` to build
    a nicer running label — it may be malformed, and that path must not throw.
  - The existing abort semantics are unchanged: on client disconnect, stop,
    flag `finish_reason: 'aborted'`, persist what streamed, do not refund
    usage. A tool executing when the abort lands is cancelled by the same
    `signal`.
  - `finally` still calls `finalizeAssistantMessage`, and now also
    `saveToolCalls({ assistantMessageId, chips })` — once, with whatever
    chips exist, including on the abort and error paths.

- **System prompt** — built per request, never persisted, prepended as
  `{ role: 'system' }`. Frozen text:

  ```
  You are a helpful assistant in a personal chat app. Today's date is <YYYY-MM-DD>.
  You can search the web and fetch pages. Use web_search when the answer depends on
  current events, prices, releases, versions, or anything you are unsure is still
  true. Use web_fetch only on URLs the user gave you or that web_search returned —
  never on a URL you guessed. Prefer one search and at most one or two fetches.
  Cite the sources you actually used as inline markdown links. If the tools fail or
  return nothing useful, say so plainly instead of guessing.
  ```

  When tools are disabled, or the model is not tool-capable, the prompt is the
  first sentence only.

- **Model gating.** Only `glm-5.3` was probed. `TOOL_CAPABLE_MODELS` (csv,
  default `glm-5.3`) lists ids that may receive a `tools` array; anything else
  streams exactly as it does today. Reuse `parseModelsCsv` from contracts —
  do not write a second csv parser.

**Tests:**
- `opencode-client.spec.ts`: a fixture stream that emits a tool call split
  across six frames reassembles into one call with the exact `arguments`
  string; a stream emitting `finish_reason` then `[DONE]` yields exactly one
  `done`; a trailing `cost` frame is captured.
- `chat.service.spec.ts`: a fake upstream that requests one tool call then
  answers produces `tool`(running) → `tool`(done) → `delta`s → one `done`, and
  exactly two upstream calls; a fake that requests tools forever stops after
  `MAX_TOOL_ROUNDS` and the final call carries no `tools` key; a failing
  `execute` still yields an answer and no `error` event; abort mid-tool
  persists the partial message and the chips.

**Done when:** `npm run test -w apps/api` green, and `curl -N` against a fake
upstream that requests a tool shows the `tool` events arriving *before* the
answer text, not batched at the end.

---

**L. Tool UI and chip persistence**
**Owns:** `apps/web/src/app/chat/**`, `apps/web/src/app/core/**`,
`apps/api/src/db/**`, `apps/api/src/conversations/**`

Two halves, one agent because they are the two ends of one seam.

**Persistence half.**

- Extend `schema.ts` and generate the migration with `drizzle-kit generate` —
  do not hand-write the SQL file. The generated DDL must come out as:

  ```sql
  CREATE TABLE message_tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    ordinal int NOT NULL,
    name text NOT NULL,
    status text NOT NULL CHECK (status IN ('done','failed')),
    label text NOT NULL,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX message_tool_calls_message_id_idx ON message_tool_calls (message_id);
  ALTER TABLE messages ADD COLUMN upstream_cost numeric;
  ```

  Both changes are purely additive, so this release stays rollable per H's
  one-way-schema note. `messages.role`'s check constraint is **not** touched —
  tool results are ephemeral and no `'tool'` row is ever written.
  `sources` holds `ToolSource[]` and nothing else: no page text, no snippets.

- Implement `saveToolCalls` in the Postgres `ConversationStore`: one
  multi-row insert, `ordinal` = array position, `status: 'running'` coerced to
  `'failed'`. It runs inside the same `finally` as
  `finalizeAssistantMessage`, so it must tolerate being called with an empty
  array (no-op, no query).

- `GET /api/conversations/:id` returns `toolCalls` on each assistant message
  that has any, ordered by `ordinal`, absent otherwise. One query for the
  whole conversation joined on `message_id` — not one per message.

**UI half.**

- New standalone component `apps/web/src/app/chat/tool-chip.ts` +
  `tool-chip.scss`. Collapsed by default: a single row, one icon, the `label`,
  and a result count. Tapping expands to the `sources` as external links
  (`target="_blank" rel="noopener noreferrer"`). `running` shows a spinner and
  is not expandable. `failed` is muted, not red — a failed lookup is normal,
  not an error state.
- Chips render **above** the assistant bubble they belong to, in `ordinal`
  order, in both the live stream and a reloaded transcript. Raw tool output
  never reaches the browser and there is nowhere in the UI it could appear.
- `chat-store.ts`: handle `tool` by upserting on `callId` into the streaming
  message's chip list; handle `thinking` by setting a `thinking` flag on the
  streaming message, cleared on the first `delta`. Unknown future `type`
  values must be ignored, not thrown on.
- `message-thread.ts` renders a "Thinking…" line when the flag is set and no
  text has arrived. This is the fix for the dead-stream gap `reasoning_content`
  causes, and it matters more once a search adds seconds of silence.
- Composer and model picker are unchanged. There is **no** search toggle in
  the UI — the model decides, and the chips show what it did.

**Tests:**
- `chat-store.spec.ts`: two `tool` events with the same `callId` produce one
  chip, not two; a `thinking` event followed by a `delta` clears the flag;
  an unknown event type is ignored.
- `tool-chip.spec.ts`: renders label, expands to sources, `running` has no
  expander.
- `conversations.service.integration.spec.ts`: chips round-trip through
  Postgres in `ordinal` order and are absent for messages without any.

**Done when:** `npm run test -w apps/api` and
`npm run test -w apps/web -- --watch=false --browsers=ChromeHeadless` are both
green, and a reloaded conversation shows the same chips it showed live.

---

### Stage gates

Three gates, each a hard stop. Nothing advances until the checks pass against
the actual artifact — not against an agent's report that it passed.

**Gate 1 — compose + dev server (after Wave 1 merges; no cluster)**

`docker compose -f docker-compose.dev.yml up` for Postgres, `npm run dev` for
the rest. `COOKIE_SECURE=false`, `APP_ORIGIN=http://localhost` — already an
authorized redirect URI on the existing Google client, so no console change is
needed to pass this gate.

- Login round-trip against the real Google client.
- Send a prompt: the Network panel must show the response arriving progressively, not as one lump.
- Reload — history intact. Delete a conversation — gone.
- `DAILY_MESSAGE_LIMIT=2`: the third send renders `LIMIT_EXCEEDED`, not a blank bubble.
- Kill the tab mid-stream; the api logs the upstream abort.
- Non-allowlisted Google account is rejected at the callback, before a session exists.

With Wave 1.5 merged, Gate 1 also covers web search. `WEB_SEARCH_ENABLED=true`,
`SEARCH_PROVIDER=searxng` against a local SearXNG with json output enabled:

- `WEB_SEARCH_ENABLED=false` first: the app behaves exactly as it did before
  Wave 1.5 — no `tools` in the upstream request, no chips. This is the
  regression check, and it runs before the enabled checks, not after.
- Ask something only the live web knows ("what is the top story on Hacker News
  right now"). A `Searching…` chip appears **before** any answer text, resolves
  to `Searched "…"`, and the answer cites links that exist.
- Paste a URL and ask for a summary: a `Read <host>` chip, and a summary that
  matches the page.
- **SSRF, the one that must not be skipped**: ask it to fetch
  `http://169.254.169.254/latest/meta-data/` and `http://localhost:5432`. Both
  come back as failed chips, the api log shows the guard refusing them, and
  `tcpdump`/the Postgres log shows no connection was attempted.
- Budget: a question that keeps the model searching stops after
  `MAX_TOOL_ROUNDS` and still produces an answer.
- Kill the tab mid-search: the api logs the upstream abort, the partial
  assistant message and its chips are both persisted.
- Reload: chips render from the database identically to the live stream.
- Stop the search provider and ask again: a failed chip, and the model answers
  from its own knowledge saying the lookup failed. No `error` event, no blank
  bubble.
- A model not in `TOOL_CAPABLE_MODELS` streams normally with no chips.

Gate 1 proves the app. It cannot prove the deployment: SSE buffering is an
nginx problem and there is no nginx here.

**Gate 2 — local kind (before anything touches Hetzner)**

Preconditions, in order: (1) Wave 1 merged and pushed, (2) a **pre-release tag**
cut (e.g. `v0.1.0-rc.1`) so the release workflow has pushed an `imageTag` the
chart can actually pull — the frameworks README's "just cut a pre-release tag"
pattern — (3) the GHCR package is public (§8 step) or the kind cluster has an
`imagePullSecrets` for it. Without the rc tag and the public package the
"real sync goes Healthy" check below cannot pass.

Adapt `frameworks/k8s/cluster-up.sh` into `k8s/cluster-up.sh` here: cluster and
namespace `opencode-chat`, secret `opencode-chat-auth`, **keep the
metrics-server step** (the `kubectl top` checks below need it), and apply the
Application from the working tree (`kubectl apply -f
argocd/opencode-chat.yaml`). The working-tree apply tests the Application
manifest only — Argo CD still pulls the chart from the repoURL, which is why
the push + rc tag above come first. Values for this gate: `ingress.host:
chat.localtest.me`, `appOrigin: http://localhost`, `COOKIE_SECURE=false`
(`localtest.me` is not a browser-trusted secure origin, so a `secure` cookie is
dropped there even though it resolves to 127.0.0.1).

- `helm lint` and `helm template | kubeconform -strict` clean.
- A real Argo CD sync goes Healthy from an empty cluster.
- **Streaming survives the ingress**: `curl -N` against `http://chat.localtest.me/api/chat` trickles rather than dumping at the end (export a session cookie from a browser login and pass it with `--cookie` — the route is guarded, a bare curl gets 401). This is the single check Gate 1 structurally cannot make, and §4-G already names it the most likely breakage. `compression()` must never appear in `main.ts` — Wave 0 owns that — because it buffers SSE regardless of the nginx annotations.
- The migrate Job completes on a **fresh install**, not only on upgrade (§4-G).
- `kubectl delete pod` on the api: probes recover and the session survives, which is the whole reason the session store is in Postgres.
- Install to an iOS home screen over the LAN and check the manifest, standalone launch and safe-area insets. The OAuth round-trip cannot be checked here — Google will not accept a private-LAN http redirect URI — so it carries to Gate 3.
- `kubectl top pods` against the §4-G budget (needs the metrics-server the bootstrap now keeps).

Then `kind delete cluster --name opencode-chat` and re-run the script once: the
bootstrap must work from zero, since that is the recovery procedure.

**Gate 3 — Hetzner**

Only once Gate 2 is green and every §8 manual step is done — including the
metrics-server on the Hetzner cluster, since `kubectl top nodes` below needs
it and §8.8's platform install does not ship one. First on the public
host: the OAuth round-trip *from the installed iOS home-screen app*, not from
Safari. A standalone PWA leaving for `accounts.google.com` and returning is the
classic place iOS drops the session cookie, and it is the last untested thing.

- `kubectl top nodes` confirms the §4-G budget fits beside any co-located
  `frameworks` workloads before the Application is applied.
- SSE streams over the public TLS endpoint (same `curl -N` with cookie as
  Gate 2, but against the real host through whatever TLS path §8.7 chose).

---

### Wave 2 — integration (one agent, after A–H merge)

- Wire D's client to A's real endpoint; delete the mock. (Gate 1 and Gate 2
  still run first — Wave 2 is the human-driven integration pass, not a single
  agent merge.)
- Tag `v0.1.0` (the Gate 2 pre-release tag covered the kind sync; this is the
  first real release), apply the Argo CD Application by hand once to the
  Hetzner cluster, watch it sync.

---

## 5. Sequencing

```
Wave 0  ████ scaffold + contracts
Wave 1  ████████████████ A B C D E F G H  (8 agents, no shared files)
Wave 1.5 ██████ J K L  (web search; K writes the frozen contracts first)
        ── Gate 1: compose + dev server, chat + search ──
        ── Gate 2: local kind, chart + ingress + SSE ──
Wave 2  ████ integration + first deploy
        ── Gate 3: Hetzner ──
```

The only cross-agent coupling is `libs/contracts`. If an agent needs a contract
change mid-wave, it stops and raises it rather than editing the file — a
unilateral edit there breaks everyone.

Wave 1.5 has one ordering constraint inside it: **K writes and pushes the
frozen interfaces first** (contracts, `ToolRuntime`, `ToolBudget`, the
`ConversationStore` addition), then J and L run in parallel against them while
K builds the loop. J and L never touch each other's paths, and neither touches
`libs/contracts`.

---

## 6. Decisions

- **History storage: Postgres.** StatefulSet + 1 Gi PVC, as in §4-G. Workstream C owns the schema.
- **Packaging: one image.** Nest serves the Angular build via `ServeStaticModule` with an SPA fallback excluding `/api` and `/auth`. No nginx container.
- **Monorepo tooling: npm workspaces.** No Nx. Consequences for Wave 0:
  - Root `package.json` with `"workspaces": ["apps/*", "libs/*"]`.
  - `@contracts/*` path mapping in both apps' `tsconfig`; the api **rewrites
    the paths at build time with `tsc-alias`** rather than carrying a
    `tsconfig-paths` runtime shim — plain `node dist/main.js` in the image.
  - `concurrently` for the root `dev` script; no task graph, no affected-detection.
  - Agents follow stock Angular CLI and Nest CLI conventions — do not introduce generator abstractions.

## 7. Resolved

- **Google OAuth: reuse the existing client** from the other project; add `https://__CHAT_HOSTNAME__/auth/google/callback` as a second authorized redirect URI. No new consent screen, no new domain verification.
- **Model list: fetch and cache.** Call `${OPENCODE_BASE_URL}/models` at boot, cache in memory, fall back to the `OPENCODE_MODELS` csv if the call fails. Refresh on pod restart only. The csv is the only source of truth in the repo; nothing hardcodes a label map.
- **Base URL, model ids and tool support: verified 2026-09-02.**
  `https://opencode.ai/zen/go/v1` is correct, `/models` returns 30+ bare ids
  including `glm-5.3`, and `/chat/completions` accepts a `tools` array with
  `glm-5.3` emitting real `tool_calls` in both streaming and non-streaming
  mode. The full probe output, including the incremental `tool_calls` frame
  shape, `reasoning_content`, the double end-of-stream signal and the trailing
  `cost` frame, is recorded under Wave 1.5 — treat that as the source of truth
  and do not re-probe.
- **Anthropic-format models: out of scope for v1.** Qwen and MiniMax are reachable only via `/v1/messages`; the `OpencodeClient` targets `/chat/completions` exclusively. Leave the client interface narrow enough that a second transport could be added later without touching the chat module.
- **Domain: subdomain of the existing domain.** Placeholder `__CHAT_HOSTNAME__` throughout; see §8.
- **Conversations: append-only.** No edit, no regenerate, no branch. Delete-whole-conversation is the only mutation.
- **Web access: model-driven tools, not server-side injection.** The
  alternative — the backend deciding when to search and pasting results into
  the prompt — was rejected once the probe showed real tool calling works: it
  cannot follow up on a bad first search, and it spends tokens on searches the
  model did not need. See Wave 1.5.
- **Tool results are ephemeral; only chips persist.** Re-sending yesterday's
  search output on every future turn of a conversation is the expensive
  failure mode, and the assistant's own answer already carries the substance.
- **No search toggle in the UI.** A toggle is one more thing to forget on a
  phone. The model decides; the chips make what it did visible after the fact.
- **Extraction with `cheerio`, not `jsdom` + Readability.** Better extraction
  is not worth a headless DOM inside a 384 Mi memory limit shared with Nest.
- **Two search providers, `searxng` and `brave`.** SearXNG for local dev and
  self-hosting with no key; Brave for the cluster, where running another
  service costs memory the CX23 does not have. Tavily and friends are a third
  adapter behind the same interface if ever wanted — not in v1.

## 8. Hostname — not yet chosen

Every reference to the public host is the literal token `__CHAT_HOSTNAME__`.
Agents must leave it as-is; do not invent a hostname. It appears in:

- `charts/opencode-chat/values.yaml` → `ingress.host`
- `charts/opencode-chat/values.yaml` → `appOrigin` (becomes `APP_ORIGIN`)
- `README.md` setup steps

Grep for it before the first deploy: `grep -rn __CHAT_HOSTNAME__ .` must come
back empty once you've decided.

### Manual steps before Wave 2 can deploy

These are yours, not an agent's. Nothing below can be automated from this repo.

0. **Cut a pre-release tag** (e.g. `v0.1.0-rc.1`) so the release workflow has
   pushed an image the chart can pull — needed before Gate 2's real sync.
1. **Pick the subdomain** (e.g. `chat.<your-domain>`) and replace the token everywhere.
2. **DNS**: A/AAAA record to the ingress, or a public-hostname route if you're on a Cloudflare Tunnel.
3. **Google Cloud console** → Credentials → the existing OAuth client → add `https://<host>/auth/google/callback` under Authorized redirect URIs. It must match `APP_ORIGIN` character-for-character: scheme, host, no trailing slash. `redirect_uri_mismatch` is the usual first-deploy failure.
4. **Make the GHCR package public** (one-time): first `v*` push creates a
   private package and every sync `ImagePullBackOff`s until this is done.
   GitHub → Packages → `opencode-chat` → Settings → Change visibility → Public.
   (Skip only if you add `imagePullSecrets` + a docker-registry Secret to the
   chart instead — decide once, document in G/H.)
5. **Create the Secret** out-of-band:
   `kubectl -n opencode-chat create secret generic opencode-chat-auth --from-env-file=.env`
   containing `OPENCODE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`.
5. **Set `ALLOWED_EMAILS`** to your Google address before the first public DNS record exists — the allowlist is the only thing standing between the open internet and your metered OpenCode key.
6. **Apply the Argo CD Application once** by hand: `kubectl apply -f argocd/opencode-chat.yaml`.
7. **TLS**: there is no cert-manager and no ClusterIssuer on the existing cluster,
   and the `frameworks` ingress has no `tls:` block — it serves plain http on
   `localtest.me`. So this is a decision, not a confirmation. Either install
   cert-manager and a ClusterIssuer and add `tls:` to the chart's ingress, or
   terminate TLS at a Cloudflare Tunnel and leave the ingress on http. Whichever
   way, `COOKIE_SECURE=true` and `APP_ORIGIN=https://...` on the public host,
   which makes `trust proxy` (§4-B) mandatory.
8. **Search provider** (Wave 1.5): decide before the first deploy. Either
   set `SEARCH_PROVIDER=brave` and add `BRAVE_SEARCH_API_KEY` to the
   out-of-band Secret (free tier is 2,000 queries/month, which is far beyond
   single-user use), or `SEARCH_PROVIDER=searxng` with `SEARXNG_BASE_URL`
   pointing at an instance you run — in which case that instance needs
   `formats: [html, json]` in its `settings.yml`, and budget ~200 Mi for it on
   a node that §4-G already calls tight. Brave is the default recommendation
   for the cluster for exactly that reason. Leaving `WEB_SEARCH_ENABLED=false`
   is a valid third answer and ships the Wave 1 behaviour.
9. **Platform layer**: ingress-nginx, Argo CD, **and metrics-server** must
   already be running on the Hetzner cluster (Gate 3's `kubectl top nodes`
   needs it — install `metrics-server` there the same way the kind bootstrap
   does, minus the insecure-tls patch). Nothing in `lkroon/charts` or
   `lkroon/frameworks` deploys there today — the only cluster either repo
   bootstraps is local kind — so treat the platform install as a prerequisite
   of Gate 3, not a given.
