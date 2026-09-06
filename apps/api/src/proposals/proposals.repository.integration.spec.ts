import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { runMigrations } from '../db/run-migrations';
import { describeIfDocker, startTestPostgres, TestPostgres } from '../db/test-postgres';
import { ProposalsRepository } from './proposals.repository';

// Integration test against a real, ephemeral postgres:16 container (see
// db/test-postgres.ts). Skipped (not failed) when Docker isn't reachable.
describeIfDocker('ProposalsRepository (integration)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let repo: ProposalsRepository;
  let accountA: number;
  let accountB: number;

  const payload = {
    title: 'Dentist',
    start: '2026-09-08T15:00:00',
    end: '2026-09-08T15:45:00',
    location: null,
    description: null,
  };

  async function createPending(accountId = accountA) {
    return repo.create({
      accountId,
      conversationId: null,
      kind: 'calendar_event',
      payload,
    });
  }

  async function backdateCreatedAt(id: string, days: number): Promise<void> {
    await pool.query(
      `UPDATE proposals SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
      [id, days],
    );
  }

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    pool = new Pool({ connectionString: pg.url });
    db = drizzle(pool, { schema });
    repo = new ProposalsRepository(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE message_tool_calls, proposals, messages, conversations, accounts RESTART IDENTITY CASCADE',
    );
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO accounts (email, display_name, google_sub, provider)
       VALUES ('a@example.com', 'A', 'sub-a', 'google'),
              ('b@example.com', 'B', 'sub-b', 'google')
       RETURNING id`,
    );
    accountA = rows[0].id;
    accountB = rows[1].id;
  });

  it('creates a pending proposal and reads it back', async () => {
    const created = await createPending();
    expect(created.status).toBe('pending');
    expect(created.kind).toBe('calendar_event');
    expect(created.payload).toEqual(payload);

    const found = await repo.findForAccount(created.id, accountA);
    expect(found!.id).toBe(created.id);
    expect(found!.createdAt instanceof Date).toBe(true);
  });

  it('never returns another account\'s proposal', async () => {
    const created = await createPending();
    expect(await repo.findForAccount(created.id, accountB)).toBeNull();
  });

  it('loads many by id in one call', async () => {
    const one = await createPending();
    const two = await createPending();
    const rows = await repo.findManyByIds([one.id, two.id, one.id]);
    expect(rows.map((r) => r.id).sort()).toEqual([one.id, two.id].sort());
    expect(await repo.findManyByIds([])).toEqual([]);
  });

  it('claims a pending proposal exactly once', async () => {
    const created = await createPending();
    const claimed = await repo.claimForExecution({
      id: created.id,
      accountId: accountA,
      allowRetry: false,
    });
    expect(claimed!.status).toBe('executing');

    const second = await repo.claimForExecution({
      id: created.id,
      accountId: accountA,
      allowRetry: false,
    });
    expect(second).toBeNull();
  });

  it('refuses to claim another account\'s proposal', async () => {
    const created = await createPending();
    const claimed = await repo.claimForExecution({
      id: created.id,
      accountId: accountB,
      allowRetry: false,
    });
    expect(claimed).toBeNull();
  });

  it('refuses to claim a proposal older than the TTL', async () => {
    const created = await createPending();
    await backdateCreatedAt(created.id, 30);
    const claimed = await repo.claimForExecution({
      id: created.id,
      accountId: accountA,
      allowRetry: false,
    });
    expect(claimed).toBeNull();
  });

  it('re-claims a failed proposal only when retries are allowed', async () => {
    const created = await createPending();
    await repo.claimForExecution({ id: created.id, accountId: accountA, allowRetry: false });
    await repo.markFailed(created.id, 'Calendar create failed (503)');

    expect(
      await repo.claimForExecution({ id: created.id, accountId: accountA, allowRetry: false }),
    ).toBeNull();
    const retried = await repo.claimForExecution({
      id: created.id,
      accountId: accountA,
      allowRetry: true,
    });
    expect(retried!.status).toBe('executing');
    // The previous error must not survive into a fresh attempt.
    expect(retried!.error).toBeNull();
  });

  it('never steals a freshly executing proposal, even with retries allowed', async () => {
    const created = await createPending();
    await repo.claimForExecution({ id: created.id, accountId: accountA, allowRetry: true });
    expect(
      await repo.claimForExecution({ id: created.id, accountId: accountA, allowRetry: true }),
    ).toBeNull();
  });

  it('reclaims an executing proposal abandoned by a dead process', async () => {
    const created = await createPending();
    await repo.claimForExecution({ id: created.id, accountId: accountA, allowRetry: true });
    await pool.query(
      `UPDATE proposals SET updated_at = now() - make_interval(mins => 30) WHERE id = $1`,
      [created.id],
    );
    const reclaimed = await repo.claimForExecution({
      id: created.id,
      accountId: accountA,
      allowRetry: true,
    });
    expect(reclaimed!.status).toBe('executing');
  });

  it('records a successful execution', async () => {
    const created = await createPending();
    const executed = await repo.markExecuted(created.id, {
      externalId: 'evt-1',
      link: 'https://calendar.google.com/event?eid=evt-1',
    });
    expect(executed!.status).toBe('executed');
    expect(executed!.externalId).toBe('evt-1');
    expect(executed!.externalLink).toBe('https://calendar.google.com/event?eid=evt-1');
  });

  it('discards a pending proposal, and refuses to discard an executed one', async () => {
    const created = await createPending();
    const discarded = await repo.discard(created.id, accountA);
    expect(discarded!.status).toBe('discarded');
    expect(await repo.discard(created.id, accountA)).toBeNull();

    const other = await createPending();
    await repo.markExecuted(other.id, { externalId: 'x', link: null });
    expect(await repo.discard(other.id, accountA)).toBeNull();
  });

  it('lists only this account\'s pending proposals, oldest first', async () => {
    const first = await createPending();
    const second = await createPending();
    const settled = await createPending();
    await repo.discard(settled.id, accountA);

    const pending = await repo.findPendingForAccount(accountA);
    expect(pending.map((row) => row.id)).toEqual([first.id, second.id]);

    // The isolation that matters: account B never sees account A's rows.
    expect(await repo.findPendingForAccount(accountB)).toEqual([]);
  });
});
