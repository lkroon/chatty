import { Pool } from 'pg';
import { upsertAccount } from './accounts.repository';
import { describeIfDocker, startTestPostgres, TestPostgres } from './test-postgres';

describeIfDocker('upsertAccount (integration, ephemeral postgres:16)', () => {
  let pg: TestPostgres;
  let pool: Pool;

  beforeAll(async () => {
    pg = await startTestPostgres();
    pool = new Pool({ connectionString: pg.url });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE accounts RESTART IDENTITY CASCADE');
  });

  it('inserts a new row when neither google_sub nor email match anything', async () => {
    const account = await upsertAccount(pool, {
      googleSub: 'sub-1',
      email: 'first@example.com',
      displayName: 'First User',
    });

    expect(account).toMatchObject({ email: 'first@example.com', displayName: 'First User' });
    const { rows } = await pool.query('SELECT * FROM accounts');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: account.id,
      email: 'first@example.com',
      google_sub: 'sub-1',
      provider: 'google',
    });
  });

  it('matches an existing row by google_sub first, updating email/display_name in place', async () => {
    const first = await upsertAccount(pool, {
      googleSub: 'sub-2',
      email: 'old-email@example.com',
      displayName: 'Old Name',
    });

    const second = await upsertAccount(pool, {
      googleSub: 'sub-2',
      email: 'new-email@example.com',
      displayName: 'New Name',
    });

    expect(second.id).toBe(first.id);
    const { rows } = await pool.query('SELECT * FROM accounts');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'new-email@example.com', display_name: 'New Name' });
  });

  it('falls back to matching by email when google_sub does not match any row', async () => {
    // Row pre-exists without a google_sub, as if seeded some other way.
    const seeded = await pool.query<{ id: number }>(
      `INSERT INTO accounts (email, display_name) VALUES ($1, $2) RETURNING id`,
      ['seeded@example.com', 'Seeded'],
    );
    const seededId = seeded.rows[0].id;

    const account = await upsertAccount(pool, {
      googleSub: 'sub-3',
      email: 'seeded@example.com',
      displayName: 'Seeded Updated',
    });

    // Matched the pre-existing row by email, not a new insert.
    expect(account.id).toBe(seededId);
    const { rows } = await pool.query('SELECT * FROM accounts');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: seededId,
      email: 'seeded@example.com',
      display_name: 'Seeded Updated',
      google_sub: 'sub-3',
    });
  });

  it('does not create a duplicate row across repeated logins for the same person', async () => {
    for (let i = 0; i < 3; i++) {
      await upsertAccount(pool, {
        googleSub: 'sub-4',
        email: 'repeat@example.com',
        displayName: `Name ${i}`,
      });
    }
    const { rows } = await pool.query('SELECT * FROM accounts');
    expect(rows).toHaveLength(1);
  });
});
