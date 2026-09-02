import { Pool } from 'pg';

export interface AccountRecord {
  id: number;
  email: string;
  displayName: string | null;
}

export interface UpsertAccountInput {
  googleSub: string;
  email: string;
  displayName: string | null;
}

/**
 * Upserts an `accounts` row for a successful, allowlisted Google login.
 * Matches an existing row first by `google_sub`, then falls back to
 * `email`, and only inserts a new row if neither matches — mirrors
 * workstream C's `accounts` migration:
 *
 *   accounts(id serial primary key, email text unique not null,
 *            display_name text, google_sub text unique,
 *            provider text not null default 'google')
 *
 * Deliberately raw SQL against a plain `pg.Pool` rather than importing
 * anything from `apps/api/src/db/**`, per workstream B's task brief (that
 * migration is built in parallel by workstream C off the same DDL and
 * won't exist at this file's build/test time).
 */
export async function upsertAccount(pool: Pool, input: UpsertAccountInput): Promise<AccountRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let match = await client.query<{ id: number; email: string; display_name: string | null }>(
      'SELECT id, email, display_name FROM accounts WHERE google_sub = $1',
      [input.googleSub],
    );
    if (match.rows.length === 0) {
      match = await client.query(
        'SELECT id, email, display_name FROM accounts WHERE email = $1',
        [input.email],
      );
    }

    let row: { id: number; email: string; display_name: string | null };
    if (match.rows.length > 0) {
      const existing = match.rows[0];
      const updated = await client.query<{ id: number; email: string; display_name: string | null }>(
        `UPDATE accounts
         SET email = $1, display_name = $2, google_sub = $3
         WHERE id = $4
         RETURNING id, email, display_name`,
        [input.email, input.displayName, input.googleSub, existing.id],
      );
      row = updated.rows[0];
    } else {
      const inserted = await client.query<{ id: number; email: string; display_name: string | null }>(
        `INSERT INTO accounts (email, display_name, google_sub, provider)
         VALUES ($1, $2, $3, 'google')
         RETURNING id, email, display_name`,
        [input.email, input.displayName, input.googleSub],
      );
      row = inserted.rows[0];
    }

    await client.query('COMMIT');
    return { id: row.id, email: row.email, displayName: row.display_name };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
