import { defineConfig } from 'drizzle-kit';

// drizzle-kit config. Run from apps/api/ (cwd matters — `schema`/`out`
// below are resolved relative to cwd, not to this file's location):
//   npx drizzle-kit generate --config=src/db/drizzle.config.ts
//   npx drizzle-kit migrate  --config=src/db/drizzle.config.ts
// Lives under src/db/ (not the apps/api package root) so it stays inside
// this workstream's owned paths and inside tsc's rootDir — see
// run-migrations.ts for how migrations are actually applied (never on
// app boot).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://app:app@localhost:5432/appdb',
  },
});
