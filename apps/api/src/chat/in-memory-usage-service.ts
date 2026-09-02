import { Injectable } from '@nestjs/common';
import type { UsageService } from '@contracts/usage-service';

// Wave 2 integration point: bind this token to workstream C's real
// Postgres-backed implementation (apps/api/src/db/postgres-usage.service.ts),
// which must satisfy libs/contracts' UsageService interface exactly.
export const USAGE_SERVICE = Symbol('USAGE_SERVICE');

const DEFAULT_DAILY_LIMIT = 200;

/**
 * Wave 1 fake for UsageService — an in-memory per-account-per-day
 * counter, good enough for workstream A's own tests. Reads
 * DAILY_MESSAGE_LIMIT from env (default 200). Not persisted across
 * restarts and not shared across replicas — that's exactly what
 * workstream C's real implementation fixes.
 */
@Injectable()
export class InMemoryUsageService implements UsageService {
  private readonly counts = new Map<string, number>();

  async consume(
    accountId: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'LIMIT_EXCEEDED' }> {
    const limit = Number(process.env.DAILY_MESSAGE_LIMIT ?? DEFAULT_DAILY_LIMIT);
    const key = `${accountId}:${new Date().toISOString().slice(0, 10)}`;
    const current = this.counts.get(key) ?? 0;
    if (current >= limit) {
      return { ok: false, reason: 'LIMIT_EXCEEDED' };
    }
    this.counts.set(key, current + 1);
    return { ok: true };
  }
}
