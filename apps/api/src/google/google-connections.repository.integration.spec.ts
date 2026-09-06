import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { runMigrations } from '../db/run-migrations';
import { describeIfDocker, startTestPostgres, TestPostgres } from '../db/test-postgres';
import { GoogleConnectionsRepository } from './google-connections.repository';

describeIfDocker('GoogleConnectionsRepository (integration)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  let repo: GoogleConnectionsRepository;
  let accountId: number;

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    pool = new Pool({ connectionString: pg.url });
    repo = new GoogleConnectionsRepository(drizzle(pool, { schema }));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM google_connections');
    await pool.query('DELETE FROM accounts');
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO accounts (email) VALUES ('a@example.com') RETURNING id`,
    );
    accountId = rows[0].id;
  });

  it('returns null when the account has no connection', async () => {
    expect(await repo.find(accountId)).toBeNull();
  });

  it('saves and reads back a connection', async () => {
    await repo.upsert(accountId, 'sealed-1', ['calendar.readonly']);
    const found = await repo.find(accountId);
    expect(found).toEqual({
      accountId,
      refreshTokenSealed: 'sealed-1',
      scopes: ['calendar.readonly'],
    });
  });

  it('upsert replaces an existing row rather than failing on the primary key', async () => {
    await repo.upsert(accountId, 'sealed-1', ['calendar.readonly']);
    await repo.upsert(accountId, 'sealed-2', ['calendar.readonly', 'gmail.readonly']);
    const found = await repo.find(accountId);
    expect(found?.refreshTokenSealed).toBe('sealed-2');
    expect(found?.scopes).toEqual(['calendar.readonly', 'gmail.readonly']);
  });

  it('remove deletes the row and is safe to call twice', async () => {
    await repo.upsert(accountId, 'sealed-1', ['calendar.readonly']);
    await repo.remove(accountId);
    await repo.remove(accountId);
    expect(await repo.find(accountId)).toBeNull();
  });

  it('round-trips an empty scopes array', async () => {
    await repo.upsert(accountId, 'sealed-1', []);
    const found = await repo.find(accountId);
    expect(found?.scopes).toEqual([]);
  });
});
