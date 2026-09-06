import { Injectable, Logger } from '@nestjs/common';
import { GoogleConnectionsRepository } from './google-connections.repository';
import { NotConnectedError } from './errors';
import { GRANT_REVOKED, refreshAccessToken } from './google-oauth';
import { decryptToken, requireEncryptionKey } from './token-crypto';

/** Refresh this many seconds before actual expiry, so a token can't die mid-request. */
const EXPIRY_MARGIN_SECONDS = 60;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Hands out Google access tokens for an account, minting them from the
 * stored refresh token and caching them in process memory.
 *
 * In-process (not Postgres) on purpose: an access token lives an hour, is
 * useless once expired, and a second replica minting its own costs one extra
 * token call. Persisting it would mean a second long-lived secret at rest for
 * no benefit.
 */
@Injectable()
export class GoogleTokenService {
  private readonly logger = new Logger(GoogleTokenService.name);
  private readonly cache = new Map<number, CachedToken>();

  constructor(private readonly connections: GoogleConnectionsRepository) {}

  async getAccessToken(accountId: number): Promise<string> {
    const cached = this.cache.get(accountId);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.accessToken;
    }

    const connection = await this.connections.find(accountId);
    if (!connection) {
      throw new NotConnectedError();
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(connection.refreshTokenSealed, requireEncryptionKey());
    } catch (err) {
      // A misconfigured key (unset, or the wrong byte length once decoded —
      // both surfaced by token-crypto.ts as "GOOGLE_TOKEN_ENCRYPTION_KEY ...")
      // is an ops problem affecting every account, not a reason to single
      // this one out — rethrow as-is rather than wiping its connection.
      // Anything else here means THIS row's sealed value can't be read under
      // an otherwise-valid key — most commonly because
      // GOOGLE_TOKEN_ENCRYPTION_KEY was rotated (documented in .env.example
      // as making existing connections undecryptable) — so this account
      // degrades to "connect again" instead of an unhandled 500 that never
      // recovers.
      if (err instanceof Error && err.message.startsWith('GOOGLE_TOKEN_ENCRYPTION_KEY ')) {
        throw err;
      }
      this.logger.warn(`Google refresh token undecryptable for account ${accountId}; clearing connection`);
      this.cache.delete(accountId);
      await this.connections.remove(accountId);
      throw new NotConnectedError('the stored Google connection could not be decrypted');
    }

    let minted: { accessToken: string; expiresInSeconds: number };
    try {
      minted = await refreshAccessToken(refreshToken);
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (message.startsWith(GRANT_REVOKED)) {
        // The grant is gone for good — retrying can only fail. Drop the row so
        // the UI offers "connect" again instead of erroring forever.
        this.logger.warn(`Google grant revoked for account ${accountId}; clearing connection`);
        this.cache.delete(accountId);
        await this.connections.remove(accountId);
        throw new NotConnectedError('the Google connection was revoked');
      }
      throw err;
    }

    this.cache.set(accountId, {
      accessToken: minted.accessToken,
      expiresAtMs: Date.now() + Math.max(0, minted.expiresInSeconds - EXPIRY_MARGIN_SECONDS) * 1000,
    });
    return minted.accessToken;
  }

  /** Drops any cached token. Call after disconnecting so a stale token can't be reused. */
  forget(accountId: number): void {
    this.cache.delete(accountId);
  }
}
