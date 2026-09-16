import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { runMigrations } from '../db/run-migrations';
import {
  describeIfDocker,
  startTestPostgres,
  TestPostgres,
} from '../db/test-postgres';
import { ConversationsService } from '../conversations/conversations.service';
import { ProposalsRepository } from '../proposals/proposals.repository';
import {
  DETAIL_MAX_CHARS,
  RAW_ARGUMENTS_MAX_CHARS,
  ToolErrorsRepository,
} from './tool-errors.repository';

// Integration test against a real, ephemeral postgres:16 container (see
// db/test-postgres.ts). Skipped (not failed) when Docker isn't reachable.
// Sticks to matchers @types/jest and @types/jasmine share — see the long
// note in conversations.service.integration.spec.ts for why.

interface ErrorRow {
  message_id: string;
  account_id: number;
  tool_name: string;
  failure_kind: string;
  raw_arguments: string | null;
  detail: string | null;
}

describeIfDocker('ToolErrorsRepository (integration)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let repository: ToolErrorsRepository;
  let conversations: ConversationsService;
  let accountId: number;
  let messageId: string;
  let conversationId: string;

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    pool = new Pool({ connectionString: pg.url });
    db = drizzle(pool, { schema });
    repository = new ToolErrorsRepository(db);
    conversations = new ConversationsService(db, new ProposalsRepository(db));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE tool_call_errors, message_tool_calls, proposals, messages, conversations, accounts RESTART IDENTITY CASCADE',
    );
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO accounts (email) VALUES ('a@example.com') RETURNING id`,
    );
    accountId = rows[0].id;
    const exchange = await conversations.startExchange({
      accountId: String(accountId),
      model: 'glm-5.3',
      userContent: 'look something up',
    });
    messageId = exchange.assistantMessageId;
    conversationId = exchange.conversationId;
  });

  async function allRows(): Promise<ErrorRow[]> {
    const { rows } = await pool.query<ErrorRow>(
      'SELECT message_id, account_id, tool_name, failure_kind, raw_arguments, detail FROM tool_call_errors ORDER BY created_at',
    );
    return rows;
  }

  it('records a failure with the arguments that caused it', async () => {
    await repository.record({
      messageId,
      accountId,
      toolName: 'web_fetch',
      failureKind: 'invalid_arguments',
      rawArguments: '{"ur',
      detail:
        'Invalid arguments for web_fetch. Answer with what you already have.',
    });

    const rows = await allRows();
    expect(rows.length).toBe(1);
    expect(rows[0].tool_name).toBe('web_fetch');
    expect(rows[0].failure_kind).toBe('invalid_arguments');
    // The whole point of the table: the arguments are recoverable
    // afterwards. Before this they were logged nowhere at all.
    expect(rows[0].raw_arguments).toBe('{"ur');
    expect(rows[0].account_id).toBe(accountId);
    expect(rows[0].message_id).toBe(messageId);
  });

  it('truncates arguments and detail rather than storing whatever it was handed', async () => {
    await repository.record({
      messageId,
      accountId,
      toolName: 'web_fetch',
      failureKind: 'invalid_arguments',
      rawArguments: 'x'.repeat(RAW_ARGUMENTS_MAX_CHARS * 3),
      detail: 'y'.repeat(DETAIL_MAX_CHARS * 3),
    });

    const rows = await allRows();
    expect(
      rows[0].raw_arguments?.startsWith('x'.repeat(RAW_ARGUMENTS_MAX_CHARS)),
    ).toBe(true);
    expect(rows[0].raw_arguments?.endsWith('…[truncated]')).toBe(true);
    expect(rows[0].detail?.endsWith('…[truncated]')).toBe(true);
  });

  it('keeps several failures from one exchange, in the order they happened', async () => {
    for (const kind of ['blocked_url', 'http_error', 'timeout'] as const) {
      await repository.record({
        messageId,
        accountId,
        toolName: 'web_fetch',
        failureKind: kind,
        rawArguments: `{"url":"https://${kind}.example"}`,
        detail: `failed: ${kind}`,
      });
    }
    const rows = await allRows();
    expect(rows.map((r) => r.failure_kind)).toEqual([
      'blocked_url',
      'http_error',
      'timeout',
    ]);
  });

  it('deleting the conversation takes its error rows with it', async () => {
    await repository.record({
      messageId,
      accountId,
      toolName: 'web_search',
      failureKind: 'search_failed',
      rawArguments: '{"query":"something the user asked about"}',
      detail: 'Search failed: provider unreachable.',
    });
    expect((await allRows()).length).toBe(1);

    await conversations.deleteForAccount(String(accountId), conversationId);

    // Diagnostics do not outlive the transcript they describe — the
    // arguments are the model's, but they are derived from the user's
    // words, and a deleted conversation has to mean deleted.
    expect((await allRows()).length).toBe(0);
  });

  it('a write that cannot land is swallowed, not thrown at the caller', async () => {
    // No such message: the FK rejects the insert. The exchange this came
    // from has already gone wrong, and losing the record of that must not
    // also lose the answer.
    let threw = false;
    try {
      await repository.record({
        messageId: '00000000-0000-0000-0000-000000000000',
        accountId,
        toolName: 'web_fetch',
        failureKind: 'http_error',
        rawArguments: '{}',
        detail: 'Fetch failed: HTTP 503',
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect((await allRows()).length).toBe(0);
  });
});
