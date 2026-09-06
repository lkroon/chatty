import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { googleConnections } from '../db/schema';
import { DB, type Db } from '../db/tokens';

export interface GoogleConnection {
  accountId: number;
  refreshTokenSealed: string;
  scopes: string[];
}

/**
 * The `google_connections` row for one account. Scopes are stored as a
 * space-separated string because that is exactly the format Google's token
 * endpoint returns them in — splitting on read keeps the stored value a
 * faithful copy of what was granted.
 */
@Injectable()
export class GoogleConnectionsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async find(accountId: number): Promise<GoogleConnection | null> {
    const rows = await this.db
      .select()
      .from(googleConnections)
      .where(eq(googleConnections.accountId, accountId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      accountId: row.accountId,
      refreshTokenSealed: row.refreshTokenSealed,
      scopes: row.scopes.split(' ').filter((s) => s.length > 0),
    };
  }

  async upsert(accountId: number, refreshTokenSealed: string, scopes: string[]): Promise<void> {
    await this.db
      .insert(googleConnections)
      .values({ accountId, refreshTokenSealed, scopes: scopes.join(' ') })
      .onConflictDoUpdate({
        target: googleConnections.accountId,
        set: {
          refreshTokenSealed,
          scopes: scopes.join(' '),
          updatedAt: sql`now()`,
        },
      });
  }

  async remove(accountId: number): Promise<void> {
    await this.db.delete(googleConnections).where(eq(googleConnections.accountId, accountId));
  }
}
