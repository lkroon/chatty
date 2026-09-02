import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { DB, PG_POOL } from './tokens';
import { PostgresUsageService } from './postgres-usage.service';

// Wave 1 workstream C: the drizzle-orm/pg connection (DATABASE_URL),
// schema, and migrations for accounts/conversations/messages/usage_counters.
// Migrations are NOT run here (or anywhere on app boot) — app boot must
// stay fast for k8s probes; a Helm hook Job applies drizzle/*.sql in the
// real deployment (see src/db/run-migrations.ts for the explicit runner
// used locally/in CI/tests).
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          connectionString: process.env.DATABASE_URL,
        }),
    },
    {
      provide: DB,
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
      inject: [PG_POOL],
    },
    PostgresUsageService,
  ],
  exports: [DB, PG_POOL, PostgresUsageService],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
