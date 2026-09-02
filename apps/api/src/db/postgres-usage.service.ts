import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { UsageService } from '@contracts/usage-service';
import { PG_POOL } from './tokens';

const DEFAULT_DAILY_LIMIT = 200;

// Real (Postgres-backed) implementation of the A<->C `UsageService` seam
// (libs/contracts/src/usage-service.ts). Workstream A currently wires an
// in-memory stand-in; a later integration step swaps it for this class —
// see this module's export from DbModule.
//
// Atomicity: the single INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING
// statement below is executed as one round trip and relies on Postgres's
// row-level locking on the (account_id, day) unique key to serialize
// concurrent increments — there is no read-then-write window for two
// concurrent requests to both observe a stale count and both pass.
// Counters are consumed on send and never refunded (including on abort) —
// deliberate, see the Wave 1 plan.
@Injectable()
export class PostgresUsageService implements UsageService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async consume(
    accountId: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'LIMIT_EXCEEDED' }> {
    const limit = Number(process.env.DAILY_MESSAGE_LIMIT ?? DEFAULT_DAILY_LIMIT);
    const result = await this.pool.query<{ message_count: number }>(
      `INSERT INTO usage_counters (account_id, day, message_count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (account_id, day)
       DO UPDATE SET message_count = usage_counters.message_count + 1
       RETURNING message_count`,
      [Number(accountId)],
    );
    const count = result.rows[0].message_count;
    if (count <= limit) {
      return { ok: true };
    }
    return { ok: false, reason: 'LIMIT_EXCEEDED' };
  }
}
