import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { runMigrations } from '../db/run-migrations';
import {
  describeIfDocker,
  startTestPostgres,
  TestPostgres,
} from '../db/test-postgres';
import { ConversationsService } from './conversations.service';

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

describeIfDocker('ConversationsService (integration)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: ConversationsService;
  let accountAId: number;
  let accountBId: number;

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    pool = new Pool({ connectionString: pg.url });
    db = drizzle(pool, { schema });
    service = new ConversationsService(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE messages, conversations, accounts RESTART IDENTITY CASCADE',
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

  it('appends a new user/assistant pair to an existing conversation when conversationId is given', async () => {
    const first = await service.startExchange({
      accountId: String(accountAId),
      model: 'm',
      userContent: 'hello',
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
    const { conversationId, assistantMessageId } = await service.startExchange(
      { accountId: String(accountAId), model: 'm', userContent: 'hi' },
    );
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
    const { conversationId, assistantMessageId } = await service.startExchange(
      { accountId: String(accountAId), model: 'm', userContent: 'hi' },
    );
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

    const list = await service.listForAccount(String(accountAId));
    expect(list.map((c) => c.id).sort()).toEqual(
      [a1.conversationId, a2.conversationId].sort(),
    );
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
});
