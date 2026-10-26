# Chat-history pagination + vectorized search — build plan

Two features, in this order:

1. **Feature A — Infinite scroll in the conversation sidebar.** The left bar
   currently loads every conversation in one `GET /api/conversations` call.
   Replace with keyset pagination + load-more-on-scroll.
2. **Feature B — Vectorized semantic search.** pgvector-backed embeddings of
   message content, written on the same paths that already persist messages,
   searched via a new `GET /api/search?q=`.

Written to be executed by hand, phase by phase, as TypeScript practice. Each
phase ends compilable with green tests.

---

## Current state (verified against the code)

- `GET /api/conversations` → `ConversationsService.listForAccount`
  (apps/api/src/conversations/conversations.service.ts) loads **every row**,
  no limit.
- Sidebar renders the whole list at once
  (apps/web/src/app/chat/conversation-list.ts).
- Messages are plain `text` in Postgres (`messages` table); no embeddings
  anywhere in the codebase.
- Postgres runs `postgres:16` in **three places**: `docker-compose.dev.yml`,
  `charts/chatty/templates/postgres.yaml`, and `run-tests.sh` — all must become
  `pgvector/pgvector:pg16` for Feature B.
- Contracts are consumed via the `@contracts/*` path alias; apps/api resolves
  it to `libs/contracts/dist` — so **run `npm run build -w libs/contracts`
  after touching contracts** (api's `pretest` does it too).
- Tests: apps/api uses jest (`*.spec.ts`, integration specs need the
  run-tests.sh postgres); apps/web uses `ng test`.

---

## Feature A: Infinite scroll in the conversation sidebar

### A1. Contract (libs/contracts/src/conversation.ts)

Add `ConversationPage`:

```ts
export interface ConversationPage {
  items: ConversationListItem[];
  /** Opaque cursor for the next page; null when exhausted. */
  nextCursor: string | null;
}
```

Build contracts: `npm run build -w libs/contracts`.

*Practice: discriminated pagination shapes; why `nextCursor: string | null`
beats `cursor?: string` (exhaustion is a value, not an absence).*

### A2. Backend keyset pagination

1. `ConversationsService.listForAccount(accountId, opts: { limit: number;
   cursor?: string })`.
   - Keyset (not OFFSET) pagination on `(updatedAt DESC, id DESC)`:
     `WHERE (updated_at, id) < (cursorUpdatedAt, cursorId)`. Use Drizzle
     `or(...)` + `and(...)` + `lt`. Practice: why keyset beats offset —
     OFFSET pages shift when a new chat bumps the list mid-scroll, keyset
     pages are stable.
   - Cursor = base64 of `${updatedAtIso}|${id}` — encode/decode in a tiny
     pure-function helper, easy to unit test. Invalid cursor →
     `BadRequestException`.
   - Return `ConversationPage`. Default limit 30, hard cap 100.
2. Controller: `@Query('limit')`, `@Query('cursor')`, parse with validation.
3. Tests in `conversations.service.integration.spec.ts`:
   - first page, second page via returned cursor
   - tie-breaking on identical `updated_at`
   - last page returns `nextCursor: null`
   - another account's rows never appear
   - invalid cursor → BadRequestException

   Ordering nuance: `updated_at` defaults to `now()` but multiple rows in one
   transaction get distinct timestamps — the `id` tiebreak makes paging fully
   deterministic.

### A3. Frontend API port

- `ChatApi.listConversationPage(cursor?: string): Observable<ConversationPage>`
  (keep old `listConversations` until the store migrates, then delete it —
  don't leave both).
- `RealChatApi`: build `URLSearchParams`, `getJson<ConversationPage>`.

### A4. Store state machine (apps/web/src/app/core/chat-store.ts)

1. New signals: `conversationsCursor`, `isLoadingMore`, and
   `hasMoreConversations = computed(() => cursor !== null)`.
2. Rework `loadConversations()` → resets and fetches page 1 (this is what
   the `meta`/`done` handlers already call — semantics preserved).
3. New `loadMoreConversations()`: appends items, stores the new cursor.
   Guard: bail if `isLoadingMore()` or no cursor (double-fire protection).
4. Dedup edge to watch: `done` triggers a page-1 refresh; if the user has
   scrolled deep, the list resets to top — acceptable v1, note it in a
   comment.

### A5. Sidebar scroll trigger (apps/web/src/app/chat/conversation-list.ts)

1. Add a sentinel element `<li class="sentinel" #sentinel>` after the `@for`.
2. `ngAfterViewInit`: `new IntersectionObserver(...)` on the sentinel →
   calls `store.loadMoreConversations()` when it enters view. `OnDestroy`
   disconnects. (Alternative: `(scroll)` handler on `.conversation-list`
   comparing `scrollTop + clientHeight >= scrollHeight - 64` —
   IntersectionObserver is the cleaner one, no scroll math.)
3. A "Loading…" row while `isLoadingMore()`.
4. Add `conversation-list.spec.ts` following the existing spec patterns in
   apps/web/src/app/chat/ (spy `CHAT_API`, flush, assert load-more fires
   when the sentinel intersects — test the store method directly and the
   observer wiring separately).

**Verify A:**

```sh
npm run build -w libs/contracts && npm run test -w apps/api -- conversations
npm run test -w apps/web
npm run lint
npm run dev   # manual scroll check
```

(The api conversations integration specs need the run-tests.sh postgres.)

---

## Feature B: Vectorized semantic search (pgvector)

### B0. Embedding provider — resolved (preflight done)

Preflight result: `POST $OPENCODE_BASE_URL/embeddings` with the OpenCode Go
key returns **unauthorized** — Zen does not serve embeddings to this
subscription. Decision gate resolved: separate provider, Google AI Studio's
OpenAI-compatible endpoint (free tier).

Add to `.env` (and `.env.example`, commented):

```dotenv
EMBEDDING_API_KEY=<Gemini API key from aistudio.google.com>
EMBEDDING_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=1536
```

Verify the new key with the same curl against the new base URL:

```sh
curl -s -w '\n%{http_code}\n' "$EMBEDDING_BASE_URL/embeddings" \
  -H "Authorization: Bearer $EMBEDDING_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemini-embedding-001","input":"ping","dimensions":1536}'
```

200 + a 1536-length array → good. `gemini-embedding-001` defaults to
3072 dimensions; the `dimensions` parameter (Gemini's OpenAI-compat name
for `output_dimensionality`) truncates to 1536, which is what the
migration stores. No manual normalization needed: pgvector's `<=>` is
cosine distance, which is magnitude-invariant — the docs' "normalize
non-3072 dims" warning is about dot-product similarity, not cosine. Any
OpenAI-compatible provider can be swapped in later by changing these env
vars; nothing else in this plan depends on Google.

### B1. Infra + migration

1. Swap `postgres:16` → `pgvector/pgvector:pg16` in `docker-compose.dev.yml`,
   `charts/chatty/templates/postgres.yaml`, and `run-tests.sh` (the test
   container must have the extension or migrations fail).
2. New Drizzle migration `0006_message_embeddings.sql`:

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE TABLE message_embeddings (
     message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
     embedding  vector(1536) NOT NULL,  -- must equal EMBEDDING_DIMENSIONS
     model      text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   -- optional at this scale; add once row count justifies it:
   CREATE INDEX message_embeddings_embedding_idx ON message_embeddings
     USING hnsw (embedding vector_cosine_ops);
   ```

3. `schema.ts`: Drizzle has no built-in `vector` type — declare it with
   `customType<{ data: number[]; driver: 'vector' }>` (good generic practice).
   Message cascade deletes embeddings automatically.

### B2. Embeddings client + write path

1. New `apps/api/src/embeddings/embedding-client.ts`:
   `embed(texts: string[]): Promise<number[][]>` — `POST
   ${EMBEDDING_BASE_URL}/embeddings` with `Authorization: Bearer
   ${EMBEDDING_API_KEY}`, OpenAI shape `{ model, input, dimensions }`,
   response `{ data: [{ embedding: number[] }] }`. Define the
   request/response types in this module (they are the embeddings module's
   own, not opencode-client's). Unit-test with the fake-server fixture
   pattern (`opencode-client.spec.ts` has the shape to copy).
2. `apps/api/src/embeddings/embeddings.service.ts` (+ module): wraps the
   client, reads `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` from env,
   truncates input to ~4000 chars (stays under gemini-embedding-001's
   2048-token input limit), `embedText()`.
3. Write path in `ConversationsService`:
   - `startExchange`: after the transaction commits, embed the user message
     **best-effort** (`.catch()` log — never fail the chat turn on an embed
     failure; never inside the tx — no network calls while holding locks).
   - `finalizeAssistantMessage`: same for the assistant content; skip empty
     content (aborted exchanges).
   - `INSERT ... ON CONFLICT (message_id) DO NOTHING`.
4. Backfill script `apps/api/src/db/backfill-embeddings.ts` (modeled on
   `run-migrations.ts`): select messages with no embedding row, batch 64,
   embed, insert, loop with progress output.

### B3. Search endpoint

1. Contract: `SearchHit { conversationId, conversationTitle, messageId, role,
   snippet, score, createdAt }`.
2. `GET /api/search?q=` → new `apps/api/src/search/` module (controller +
   service):
   - embed the query via `EmbeddingsService`
   - SQL with Drizzle template:

     ```ts
     sql`select ... from message_embeddings me
         join messages m on m.id = me.message_id
         join conversations c on c.id = m.conversation_id
         where c.account_id = ${accountId}
         order by me.embedding <=> ${vectorLiteral} limit 20`
     ```

     Vector literal must be the pgvector text form `'[0.1,0.2,...]'` — a
     small `toVectorLiteral()` helper. `score = 1 - distance`. Snippet =
     `left(m.content, 200)`. 404-safety: same "never distinguish not-found
     from other-account's" rule as the conversations module.
3. Tests: integration spec with seeded conversations + embeddings (inject a
   fake embedder that returns deterministic vectors, e.g. one-hot — lets you
   assert ranking without any network).

### B4. Search UI

1. Search input in `conversation-list.ts` sidebar head (or
   `chat-shell.html` `sidebar__head` — pick one owner).
2. `ChatStore`: `searchQuery` signal, `searchHits`, `isSearching`;
   `search(q)` debounced ~300ms (rxJS `debounceTime` via `toObservable`, or a
   manual `setTimeout` reset pattern — good practice either way). Empty
   query → back to the conversation list.
3. While a query is active, render hits instead of conversations: title +
   snippet + score, click → `selectConversation(hit.conversationId)`
   (scroll-to-message is explicitly out of scope for v1).
4. `ChatApi`/`RealChatApi`: `search(q: string): Observable<SearchHit[]>`.
5. Test: store-level spec (fake `CHAT_API` returns hits, assert signals),
   component spec for the query/hits toggle.

**Verify B:** the same lint/test trio, plus backfill + search against dev
Postgres, plus one manual search for a phrase that only matches semantically
(worded differently from a stored message).

---

## Suggested order

A fully first (independent and shippable), then B0 → B4. Each phase ends
compilable + green tests.

## Notes / risks

- The existing `pgdata` volume keeps working with the pgvector image (it's a
  superset), but the container must be recreated:
  `docker compose -f docker-compose.dev.yml up -d`.
- Prod migration job (`charts/chatty/templates/migrate-job.yaml`) runs these
  migrations on deploy — `CREATE EXTENSION` needs superuser; the chart's
  postgres runs as the postgres superuser, so that's fine.
- If a chat model is retired server-side nothing changes — embeddings are
  keyed by message, not model.
- B0 resolved: OpenCode Zen does not serve embeddings with the Go
  subscription key (preflight curl → unauthorized). The embeddings client
  reads `EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY` instead, pointed at Google
  AI Studio — switching providers later is an `.env` change only. If the
  provider ever changes to one with different dimensions, the
  `message_embeddings` table needs a re-migration + re-backfill; the stored
  `model` column exists so the backfill script can tell.
