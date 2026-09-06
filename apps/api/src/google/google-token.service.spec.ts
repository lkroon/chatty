import { randomBytes } from 'node:crypto';
import { encryptToken } from './token-crypto';
import { GoogleTokenService } from './google-token.service';
import { NotConnectedError } from './errors';
import type { GoogleConnection } from './google-connections.repository';
import * as oauth from './google-oauth';

class FakeRepo {
  connection: GoogleConnection | null = null;
  removed: number[] = [];
  find = jest.fn(async () => this.connection);
  remove = jest.fn(async (accountId: number) => {
    this.removed.push(accountId);
    this.connection = null;
  });
  upsert = jest.fn(async () => undefined);
}

describe('GoogleTokenService', () => {
  const key = randomBytes(32).toString('base64');
  let repo: FakeRepo;
  let service: GoogleTokenService;
  let refreshSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = key;
    repo = new FakeRepo();
    repo.connection = {
      accountId: 1,
      refreshTokenSealed: encryptToken('rt', key),
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    };
    service = new GoogleTokenService(repo as never);
    refreshSpy = jest
      .spyOn(oauth, 'refreshAccessToken')
      .mockResolvedValue({ accessToken: 'at-1', expiresInSeconds: 3600 });
  });

  afterEach(() => {
    refreshSpy.mockRestore();
  });

  it('mints an access token from the stored refresh token', async () => {
    await expect(service.getAccessToken(1)).resolves.toBe('at-1');
    expect(refreshSpy).toHaveBeenCalledWith('rt');
  });

  it('caches the token instead of refreshing on every call', async () => {
    await service.getAccessToken(1);
    await service.getAccessToken(1);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes again once the cached token is inside the expiry margin', async () => {
    refreshSpy.mockResolvedValue({ accessToken: 'short', expiresInSeconds: 30 });
    await service.getAccessToken(1);
    await service.getAccessToken(1);
    expect(refreshSpy).toHaveBeenCalledTimes(2);
  });

  it('throws NotConnectedError when the account has no connection', async () => {
    repo.connection = null;
    await expect(service.getAccessToken(1)).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('deletes the connection and reports not-connected when the grant was revoked', async () => {
    refreshSpy.mockRejectedValue(new Error(`${oauth.GRANT_REVOKED}: nope`));
    await expect(service.getAccessToken(1)).rejects.toBeInstanceOf(NotConnectedError);
    expect(repo.removed).toEqual([1]);
  });

  it('does not delete the connection on a transient failure', async () => {
    refreshSpy.mockRejectedValue(new Error('Google token refresh failed (503)'));
    await expect(service.getAccessToken(1)).rejects.toThrow(/503/);
    expect(repo.removed).toEqual([]);
  });

  it('deletes the connection and reports not-connected when the stored token is undecryptable', async () => {
    // Simulates a rotated GOOGLE_TOKEN_ENCRYPTION_KEY: the sealed value was
    // produced under a different key than the one now configured.
    repo.connection = {
      accountId: 1,
      refreshTokenSealed: encryptToken('rt', randomBytes(32).toString('base64')),
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    };
    await expect(service.getAccessToken(1)).rejects.toBeInstanceOf(NotConnectedError);
    expect(repo.removed).toEqual([1]);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('does not delete the connection or mask the error when the encryption key is entirely unset', async () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    try {
      await expect(service.getAccessToken(1)).rejects.toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY is not set/);
      expect(repo.removed).toEqual([]);
    } finally {
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = key;
    }
  });

  it('does not delete the connection when the configured key is the wrong length', async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    try {
      await expect(service.getAccessToken(1)).rejects.toThrow(/must decode to exactly 32 bytes/);
      expect(repo.removed).toEqual([]);
    } finally {
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = key;
    }
  });

  it('keeps one account cached token from serving another account', async () => {
    refreshSpy.mockResolvedValueOnce({ accessToken: 'at-1', expiresInSeconds: 3600 });
    refreshSpy.mockResolvedValueOnce({ accessToken: 'at-2', expiresInSeconds: 3600 });
    await expect(service.getAccessToken(1)).resolves.toBe('at-1');
    await expect(service.getAccessToken(2)).resolves.toBe('at-2');
  });
});
