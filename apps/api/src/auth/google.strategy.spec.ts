import { Pool } from 'pg';
import type { Profile } from 'passport-google-oauth20';
import { googleVerifyCallback, AuthenticatedUser } from './google.strategy';
import { describeIfDocker, startTestPostgres, TestPostgres } from './test-postgres';

function fakeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    provider: 'google',
    id: 'sub-123',
    displayName: 'Alice Example',
    emails: [{ value: 'alice@example.com', verified: true }],
    photos: [{ value: 'https://example.com/alice.jpg' }],
    profileUrl: '',
    _raw: '{}',
    _json: {} as Profile['_json'],
    ...overrides,
  } as Profile;
}

// No live OAuth round-trip here (per task constraints) — the verify
// callback is called directly with a hand-constructed fake Google
// profile, exactly like passport-google-oauth20 would call it after a
// real exchange.
describe('googleVerifyCallback (allowlist gate, no DB needed)', () => {
  const originalAllowed = process.env.ALLOWED_EMAILS;

  afterEach(() => {
    process.env.ALLOWED_EMAILS = originalAllowed;
  });

  it('rejects a non-allowlisted email WITHOUT touching the database', async () => {
    process.env.ALLOWED_EMAILS = 'someone-else@example.com';
    const poisonedPool = {
      connect: jest.fn(() => {
        throw new Error('must not be called for a rejected login');
      }),
    } as unknown as Pool;

    const done = jest.fn();
    await googleVerifyCallback(poisonedPool, fakeProfile(), done);

    expect(done).toHaveBeenCalledWith(null, false);
    expect((poisonedPool as unknown as { connect: jest.Mock }).connect).not.toHaveBeenCalled();
  });

  it('never throws for a rejected login — fails the strategy, does not 500', async () => {
    process.env.ALLOWED_EMAILS = '';
    const done = jest.fn();
    await expect(googleVerifyCallback({} as Pool, fakeProfile(), done)).resolves.toBeUndefined();
    expect(done).toHaveBeenCalledWith(null, false);
  });

  it('rejects when the Google profile has no email at all', async () => {
    process.env.ALLOWED_EMAILS = 'alice@example.com';
    const done = jest.fn();
    await googleVerifyCallback({} as Pool, fakeProfile({ emails: undefined }), done);
    expect(done).toHaveBeenCalledWith(null, false);
  });
});

describeIfDocker('googleVerifyCallback (integration, allowlisted login upserts accounts)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  const originalAllowed = process.env.ALLOWED_EMAILS;

  beforeAll(async () => {
    pg = await startTestPostgres();
    pool = new Pool({ connectionString: pg.url });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
    process.env.ALLOWED_EMAILS = originalAllowed;
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE accounts RESTART IDENTITY CASCADE');
    process.env.ALLOWED_EMAILS = 'alice@example.com';
  });

  it('upserts a new account and returns it on first, allowlisted login', async () => {
    const done = jest.fn();
    await googleVerifyCallback(pool, fakeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    const [err, user] = done.mock.calls[0];
    expect(err).toBeNull();
    const authUser = user as AuthenticatedUser;
    expect(authUser.email).toBe('alice@example.com');
    expect(authUser.name).toBe('Alice Example');
    expect(authUser.picture).toBe('https://example.com/alice.jpg');
    expect(typeof authUser.id).toBe('number');

    const { rows } = await pool.query('SELECT * FROM accounts');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'alice@example.com',
      display_name: 'Alice Example',
      google_sub: 'sub-123',
      provider: 'google',
    });
  });

  it('reuses the same account (no duplicate) on a second login with the same google_sub', async () => {
    const done1 = jest.fn();
    await googleVerifyCallback(pool, fakeProfile(), done1);
    const firstId = (done1.mock.calls[0][1] as AuthenticatedUser).id;

    const done2 = jest.fn();
    await googleVerifyCallback(pool, fakeProfile({ displayName: 'Alice Renamed' }), done2);
    const secondId = (done2.mock.calls[0][1] as AuthenticatedUser).id;

    expect(secondId).toBe(firstId);
    const { rows } = await pool.query('SELECT * FROM accounts');
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('Alice Renamed');
  });
});
