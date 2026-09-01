import { Pool } from 'pg';

// Single shared pg.Pool for the whole api process: handed to
// connect-pg-simple as the session store's `pool` option (see main.ts's
// session({...}) block, workstream B's editable seam) and used directly
// for the `accounts` upsert query (accounts.repository.ts). One pool
// keeps connection settings/limits in one place instead of opening a
// second pool from DATABASE_URL for no reason.
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
