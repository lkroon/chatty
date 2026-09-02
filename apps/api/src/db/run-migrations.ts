import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { join } from 'node:path';

// Explicit migration runner. NOT invoked on app boot (app boot must stay
// fast for k8s probes) — in the real deployment migrations run as a Helm
// hook Job. Locally / in CI, run this directly against a Postgres
// instance:
//
//   DATABASE_URL=postgresql://... npx ts-node src/db/run-migrations.ts
//
// (also used by this module's own integration test's beforeAll).
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
  await pool.end();
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('migrations applied');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
