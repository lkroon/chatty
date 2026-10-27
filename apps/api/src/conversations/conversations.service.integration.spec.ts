import { Pool } from 'pg';
import { BadRequestException } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { runMigrations } from '../db/run-migrations';
import {
  describeIfDocker,
  startTestPostgres,
  TestPostgres,
} from '../db/test-postgres';
import { keywordEmbedder, oneHot } from '../embeddings/fake-embedder';
import type { Embedder } from '../embeddings/embeddings.service';
import { toVectorLiteral } from '../search/vector-literal';
import { ConversationsService } from './conversations.service';
import { ProposalsRepository } from '../proposals/proposals.repository';

// Integration test against a real, ephemeral postgres:16 container (see
// db/test-postgres.ts). Skipped (not failed) when Docker isn't reachable.

// NOTE: this file deliberately avoids `.rejects`/`.resolves` and
// `toMatchObject`/`toHaveLength` — apps/web's @types/jasmine (a legitimate
// Angular/Karma devDependency) gets hoisted into the shared root
// node_modules by npm workspaces and shadows @types/jest's global
// `expect` types in apps/api (which has no tsconfig `types` restriction
// to prevent it), so those jest-only matcher APIs fail to type-check here
// even though they work at runtime. Sticking to matchers both type
// definitions share (toBe/toEqual/toBeTruthy/toContain/try-catch for
// rejection assertions) keeps this file compiling regardless. Flagged in
// the workstream report — the real fix (restricting apps/api's tsconfig
// `types`) is outside this workstream's owned files.
async function expectToReject(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject, but it resolved');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The embedding write path is fire-and-forget by design (a slow provider
 * must not delay the chat turn), so the spec polls the table until the
 * row lands — bounded, so a real failure surfaces as a timeout rather
 * than a hang.
 */
async function waitForEmbeddingRow(
  pool: Pool,
  messageId: string,
): Promise<{ embedding: unknown; model: string }> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await pool.query(
      'select embedding, model from message_embeddings where message_id = $1',
      [messageId],
    );
    if (rows.length > 0) {
      return rows[0];
    }
    if (Date.now() > deadline) {
      throw new Error(`embedding row for ${messageId} never appeared`);
    }
    await sleep(25);
  }
}

describeIfDocker('ConversationsService (integration)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: ConversationsService;
  let accountAId: number;
  let accountBId: number;

  // keywordEmbedder: 'alpha' → one-hot 0, 'beta' → one-hot 1 — the
  // write-path tests below assert on those exact vectors.
  const fakeEmbedder = keywordEmbedder(['alpha', 'beta']);

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    pool = new Pool({ connectionString: pg.url });
    db = drizzle(pool, { schema });
    service = new ConversationsService(
      db,
      new ProposalsRepository(db),
      fakeEmbedder,
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE message_tool_calls, message_embeddings, proposals, messages, conversations, accounts RESTART IDENTITY CASCADE',
    );
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO accounts (email) VALUES ('a@example.com'), ('b@example.com') RETURNING id`,
    );
    accountAId = rows[0].id;
    accountBId = rows[1].id;
  });

  it('creates a conversation, user message, and empty assistant placeholder when no conversationId is given', async () => {
    const longContent = 'x'.repeat(80);
    const result = await service.startExchange({
      accountId: String(accountAId),
      model: 'glm-5.3',
      userContent: longContent,
    });

    expect(result.conversationId).toBeTruthy();
    expect(result.assistantMessageId).toBeTruthy();

    const detail = await service.getDetailForAccount(
      String(accountAId),
      result.conversationId,
    );
    // Title = first 60 chars of userContent, no LLM-generated titles.
    expect(detail.title).toBe('x'.repeat(60));
    expect(detail.messages.length).toBe(2);

    const [userMsg, assistantMsg] = detail.messages;
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toBe(longContent);
    expect(userMsg.finishReason).toBeNull();

    expect(assistantMsg.id).toBe(result.assistantMessageId);
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe('');
    expect(assistantMsg.finishReason).toBeNull();
  });

  it('keeps insertion order when messages share the same timestamp', async () => {
    const result = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hello',
    });
    await pool.query(
      `UPDATE messages SET created_at = '2026-09-16T12:00:00Z' WHERE conversation_id = $1`,
      [result.conversationId],
    );

    const detail = await service.getDetailForAccount(
      String(accountAId),
      result.conversationId,
    );
    expect(detail.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('appends a new user/assistant pair to an existing conversation when conversationId is given', async () => {
    const first = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hello',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId: first.assistantMessageId,
      content: 'hi',
      aborted: false,
    });
    const second = await service.startExchange({
      accountId: String(accountAId),
      conversationId: first.conversationId,
      model: 'm',
      userContent: 'again',
    });

    expect(second.conversationId).toBe(first.conversationId);
    const detail = await service.getDetailForAccount(
      String(accountAId),
      first.conversationId,
    );
    expect(detail.messages.length).toBe(4);
  });

  it('rejects a second exchange while the conversation has an active assistant placeholder', async () => {
    const first = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hello',
    });
    const error = await expectToReject(
      service.startExchange({
        accountId: String(accountAId),
        conversationId: first.conversationId,
        model: 'm',
        userContent: 'again',
      }),
    );
    expect((error as Error).message).toContain('active exchange');
    const detail = await service.getDetailForAccount(
      String(accountAId),
      first.conversationId,
    );
    expect(detail.messages.length).toBe(2);
  });

  it('returns history for the account without the current assistant placeholder', async () => {
    const first = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hello',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId: first.assistantMessageId,
      content: 'hi',
      aborted: false,
    });

    const second = await service.startExchange({
      accountId: String(accountAId),
      conversationId: first.conversationId,
      model: 'm',
      userContent: 'follow up',
    });

    const history = await service.getHistory({
      accountId: String(accountAId),
      conversationId: first.conversationId,
      excludeMessageId: second.assistantMessageId,
    });

    expect(history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'follow up' },
    ]);
  });

  it('rejects appending to a conversation owned by a different account', async () => {
    const { conversationId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hi',
    });

    await expectToReject(
      service.startExchange({
        accountId: String(accountBId),
        conversationId,
        model: 'm',
        userContent: 'hijack',
      }),
    );
  });

  it('finalizeAssistantMessage sets content and a null finishReason on normal completion', async () => {
    const { conversationId, assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hi',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId,
      content: 'the answer',
      aborted: false,
    });

    const detail = await service.getDetailForAccount(
      String(accountAId),
      conversationId,
    );
    const assistant = detail.messages.find((m) => m.id === assistantMessageId);
    expect(assistant?.content).toBe('the answer');
    expect(assistant?.finishReason).toBeNull();
  });

  it("finalizeAssistantMessage sets finishReason to 'aborted' on abort", async () => {
    const { conversationId, assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hi',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId,
      content: 'partial',
      aborted: true,
    });

    const detail = await service.getDetailForAccount(
      String(accountAId),
      conversationId,
    );
    const assistant = detail.messages.find((m) => m.id === assistantMessageId);
    expect(assistant?.content).toBe('partial');
    expect(assistant?.finishReason).toBe('aborted');
  });

  it("lists only the requesting account's conversations, most-recently-updated first", async () => {
    const a1 = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'a1',
    });
    await service.startExchange({
      accountId: String(accountBId),
      model: 'm',
      userContent: 'b1',
    });
    const a2 = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'a2',
    });

    const opt = { limit: 10 };

    const list = await service.listForAccount(String(accountAId), opt);
    expect(list.items.map((c) => c.id).sort()).toEqual(
      [a1.conversationId, a2.conversationId].sort(),
    );
  });

  it('paginates keyset-style: two full pages, a final partial page, then a null cursor', async () => {
    const created: { conversationId: string }[] = [];
    for (let i = 0; i < 5; i++) {
      created.push(
        await service.startExchange({
          accountId: String(accountAId),
          model: 'm',
          userContent: `c${i}`,
        }),
      );
    }
    const other = await service.startExchange({
      accountId: String(accountBId),
      model: 'm',
      userContent: 'other account',
    });

    // Distinct timestamps in creation order, so newest-first is c4..c0.
    for (let i = 0; i < created.length; i++) {
      await pool.query(
        'UPDATE conversations SET updated_at = $1 WHERE id = $2',
        [new Date(Date.UTC(2026, 0, 1, 12, i, 0)), created[i].conversationId],
      );
    }
    // Newest overall — but account B's row must never surface in A's pages.
    await pool.query(
      'UPDATE conversations SET updated_at = $1 WHERE id = $2',
      [new Date(Date.UTC(2026, 0, 2, 12, 0, 0)), other.conversationId],
    );

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await service.listForAccount(String(accountAId), {
        limit: 2,
        cursor,
      });
      pageSizes.push(page.items.length);
      seen.push(...page.items.map((c) => c.id));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(pageSizes).toEqual([2, 2, 1]);
    expect(seen).toEqual(
      created
        .slice()
        .reverse()
        .map((c) => c.conversationId),
    );
  });

  it('returns a null nextCursor when the rows land exactly on the limit boundary', async () => {
    await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'a',
    });
    await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'b',
    });

    const page = await service.listForAccount(String(accountAId), {
      limit: 2,
    });
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).toBeNull();
  });

  it('tie-breaks identical updated_at values by id DESC so paging is deterministic', async () => {
    const created: { conversationId: string }[] = [];
    for (let i = 0; i < 3; i++) {
      created.push(
        await service.startExchange({
          accountId: String(accountAId),
          model: 'm',
          userContent: `t${i}`,
        }),
      );
    }
    const sameInstant = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    for (const c of created) {
      await pool.query(
        'UPDATE conversations SET updated_at = $1 WHERE id = $2',
        [sameInstant, c.conversationId],
      );
    }
    // Ground truth from Postgres itself, with the same ordering the
    // service promises.
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM conversations WHERE account_id = $1 ORDER BY updated_at DESC, id DESC',
      [accountAId],
    );
    const expected = rows.map((r) => r.id);

    const first = await service.listForAccount(String(accountAId), {
      limit: 2,
    });
    expect(first.items.map((c) => c.id)).toEqual(expected.slice(0, 2));
    expect(first.nextCursor).toBeTruthy();

    const second = await service.listForAccount(String(accountAId), {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((c) => c.id)).toEqual(expected.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor with BadRequestException', async () => {
    const err = await expectToReject(
      service.listForAccount(String(accountAId), {
        limit: 10,
        cursor: 'garbage!',
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it("404s (does not leak existence) when reading another account's conversation", async () => {
    const { conversationId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'secret',
    });

    await expectToReject(
      service.getDetailForAccount(String(accountBId), conversationId),
    );
  });

  it('finalizeAssistantMessage persists the summed upstream cost, and null when none was reported', async () => {
    const { assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hi',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId,
      content: 'the answer',
      aborted: false,
      cost: 0.0042,
    });

    const { rows } = await pool.query<{ upstream_cost: string | null }>(
      'SELECT upstream_cost FROM messages WHERE id = $1',
      [assistantMessageId],
    );
    expect(Number(rows[0].upstream_cost)).toBe(0.0042);
  });

  it('saveToolCalls round-trips chips through Postgres in ordinal order, and messages without any have no toolCalls field', async () => {
    const { conversationId, assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'search for something',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId,
      content: 'Here is what I found.',
      aborted: false,
    });
    await service.saveToolCalls({
      assistantMessageId,
      chips: [
        {
          callId: 'call-1',
          name: 'web_search',
          status: 'done',
          label: 'Searched "something"',
          sources: [
            { title: 'Something', url: 'https://example.com/something' },
          ],
        },
        {
          callId: 'call-2',
          name: 'web_fetch',
          status: 'running', // must be coerced to 'failed' — 'running' isn't storable.
          label: 'Reading…',
          sources: [],
        },
      ],
    });

    const detail = await service.getDetailForAccount(
      String(accountAId),
      conversationId,
    );
    const userMsg = detail.messages.find((m) => m.role === 'user');
    const assistantMsg = detail.messages.find(
      (m) => m.id === assistantMessageId,
    );

    expect(userMsg?.toolCalls).toBe(undefined);
    expect(assistantMsg?.toolCalls?.length).toBe(2);
    expect(assistantMsg?.toolCalls?.[0]).toEqual({
      callId: expect.anything(),
      name: 'web_search',
      status: 'done',
      label: 'Searched "something"',
      sources: [{ title: 'Something', url: 'https://example.com/something' }],
    });
    expect(assistantMsg?.toolCalls?.[1]).toEqual({
      callId: expect.anything(),
      name: 'web_fetch',
      status: 'failed',
      label: 'Reading…',
      sources: [],
    });
  });

  it('saveToolCalls tolerates an empty array (no-op, no query)', async () => {
    const { assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hi',
    });
    await service.saveToolCalls({ assistantMessageId, chips: [] });
    const { rows } = await pool.query(
      'SELECT * FROM message_tool_calls WHERE message_id = $1',
      [assistantMessageId],
    );
    expect(rows.length).toBe(0);
  });

  it("refuses to delete another account's conversation, and cascades messages when it does delete", async () => {
    const { conversationId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'secret',
    });

    await expectToReject(
      service.deleteForAccount(String(accountBId), conversationId),
    );

    await service.deleteForAccount(String(accountAId), conversationId);
    const { rows } = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1',
      [conversationId],
    );
    expect(rows.length).toBe(0);
  });

  it("rebuilds a chip's proposal card from the row, not from what was stored", async () => {
    const repository = new ProposalsRepository(db);
    const { conversationId, assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'glm-5.3',
      userContent: 'book the dentist',
    });
    const proposal = await repository.create({
      accountId: accountAId,
      conversationId,
      kind: 'calendar_event',
      payload: {
        title: 'Dentist',
        start: '2026-09-08T15:00:00',
        end: '2026-09-08T15:45:00',
        location: null,
        description: null,
      },
    });

    await service.finalizeAssistantMessage({
      assistantMessageId,
      content: 'I have proposed that.',
      aborted: false,
    });
    await service.saveToolCalls({
      assistantMessageId,
      chips: [
        {
          callId: 'call-1',
          name: 'create_calendar_event',
          status: 'done',
          label: 'Proposed: Dentist',
          sources: [],
          proposal: {
            id: proposal.id,
            kind: 'calendar_event',
            status: 'pending',
            title: 'Dentist',
            fields: [],
            chip: null,
            link: null,
            error: null,
            confirmable: true,
            expiresAt: '2026-09-08T09:59:00.000Z',
            conversationId,
          },
        },
      ],
    });

    // The world moves on: the user confirms, and the row becomes executed.
    await repository.claimForExecution({
      id: proposal.id,
      accountId: accountAId,
      allowRetry: false,
    });
    await repository.markExecuted(proposal.id, {
      externalId: 'evt-1',
      link: 'https://cal/evt-1',
    });

    const detail = await service.getDetailForAccount(
      String(accountAId),
      conversationId,
    );
    const assistant = detail.messages.find((m) => m.role === 'assistant')!;
    const chip = assistant.toolCalls![0];
    expect(chip.proposal!.status).toBe('executed');
    expect(chip.proposal!.confirmable).toBe(false);
    expect(chip.proposal!.link).toBe('https://cal/evt-1');
    // The card is rebuilt from the payload, so its fields are present even
    // though an empty array was what got stored on the chip.
    expect(chip.proposal!.fields.length).toBeGreaterThan(0);
  });

  // --- Feature B: best-effort embedding write path ---

  it('startExchange embeds the user message after the transaction commits', async () => {
    const { userMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'tell me about alpha',
    });

    const row = await waitForEmbeddingRow(pool, userMessageId);
    expect(row.model).toBe('fake-embedding-model');
    // 'alpha' is keyword 0 in the fake embedder — the stored vector must
    // be that exact one-hot, round-tripped through pgvector's text form.
    expect(String(row.embedding)).toBe(toVectorLiteral(oneHot(0)));
  });

  it('finalizeAssistantMessage embeds non-empty assistant content', async () => {
    const { assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hello',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId,
      content: 'the answer is beta',
      aborted: false,
    });

    const row = await waitForEmbeddingRow(pool, assistantMessageId);
    expect(String(row.embedding)).toBe(toVectorLiteral(oneHot(1)));
  });

  it('finalizeAssistantMessage skips empty content (aborted exchanges with no text)', async () => {
    const { assistantMessageId } = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hello',
    });
    await service.finalizeAssistantMessage({
      assistantMessageId,
      content: '',
      aborted: true,
    });

    // Fire-and-forget means "no row" is the absence of a write that may
    // still be in flight — a bounded wait makes this a timeout on failure
    // rather than a race that sometimes passes.
    await sleep(200);
    const { rows } = await pool.query(
      'select * from message_embeddings where message_id = $1',
      [assistantMessageId],
    );
    expect(rows.length).toBe(0);
  });

  it('never fails the chat turn when the embedder errors', async () => {
    const failing: Embedder = {
      enabled: true,
      model: 'failing-model',
      embedText: () => Promise.reject(new Error('provider down')),
      embedTexts: () => Promise.reject(new Error('provider down')),
    };
    const failingService = new ConversationsService(
      db,
      new ProposalsRepository(db),
      failing,
    );

    const result = await failingService.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'alpha',
    });
    await failingService.finalizeAssistantMessage({
      assistantMessageId: result.assistantMessageId,
      content: 'beta',
      aborted: false,
    });

    // The turn succeeded; the embeddings just didn't happen.
    expect(result.conversationId).toBeTruthy();
    await sleep(200);
    const { rows } = await pool.query(
      'select * from message_embeddings where message_id in ($1, $2)',
      [result.userMessageId, result.assistantMessageId],
    );
    expect(rows.length).toBe(0);
  });
});
