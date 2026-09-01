import { Pool } from 'pg';
import { runMigrations } from './run-migrations';
import { describeIfDocker, startTestPostgres, TestPostgres } from './test-postgres';
import { PostgresUsageService } from './postgres-usage.service';

// Integration test against a real, ephemeral postgres:16 container (see
// test-postgres.ts). Skipped (not failed) when Docker isn't reachable, so
// this file doesn't break `npm test` in an environment without it.
describeIfDocker('PostgresUsageService (integration)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  let service: PostgresUsageService;
  const originalLimit = process.env.DAILY_MESSAGE_LIMIT;

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    pool = new Pool({ connectionString: pg.url });
    service = new PostgresUsageService(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
    process.env.DAILY_MESSAGE_LIMIT = originalLimit;
  });

  async function seedAccount(): Promise<string> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO accounts (email) VALUES ($1) RETURNING id`,
      [`race-${Date.now()}-${Math.random()}@example.com`],
    );
    return String(rows[0].id);
  }

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE usage_counters, messages, conversations, accounts RESTART IDENTITY CASCADE',
    );
  });

  it('accounts table matches the frozen DDL exactly (workstream B depends on this)', async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'accounts'
       ORDER BY ordinal_position`,
    );

    expect(
      rows.map((r) => ({
        column_name: r.column_name,
        data_type: r.data_type,
        is_nullable: r.is_nullable,
      })),
    ).toEqual([
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'display_name', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'google_sub', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'provider', data_type: 'text', is_nullable: 'NO' },
    ]);
    expect(rows.find((r) => r.column_name === 'provider')?.column_default).toBe(
      "'google'::text",
    );
  });

  it(
    'allows exactly N concurrent consume() calls to succeed when the daily ' +
      'limit is N — proves the increment is atomic, not read-then-write ' +
      '(a naive implementation lets more than N through under concurrency)',
    async () => {
      process.env.DAILY_MESSAGE_LIMIT = '3';
      const accountId = await seedAccount();

      const results = await Promise.all(
        Array.from({ length: 10 }, () => service.consume(accountId)),
      );

      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;

      expect(succeeded).toBe(3);
      expect(failed).toBe(7);
      expect(
        results
          .filter((r): r is { ok: false; reason: 'LIMIT_EXCEEDED' } => !r.ok)
          .every((r) => r.reason === 'LIMIT_EXCEEDED'),
      ).toBe(true);

      // Never refunded: the counter reflects all 10 attempts, not just the
      // 3 that passed.
      const { rows } = await pool.query<{ message_count: number }>(
        'SELECT message_count FROM usage_counters WHERE account_id = $1',
        [accountId],
      );
      expect(rows[0].message_count).toBe(10);
    },
    30_000,
  );

  it('rejects a call once a prior call already reached the limit', async () => {
    process.env.DAILY_MESSAGE_LIMIT = '1';
    const accountId = await seedAccount();

    const first = await service.consume(accountId);
    const second = await service.consume(accountId);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: 'LIMIT_EXCEEDED' });
  });
});
