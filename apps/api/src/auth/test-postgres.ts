import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

// Self-contained ephemeral-Postgres test fixture for this module's own
// specs. Deliberately does NOT import apps/api/src/db/test-postgres.ts
// (workstream C's equivalent helper, built in parallel off the same DDL)
// per this workstream's task brief: auth's tests must not depend on
// files another workstream is writing concurrently. Some duplication
// with that file is expected and fine.

export interface TestPostgres {
  url: string;
  stop: () => void;
}

/** True if a `docker` binary is reachable. */
export function isDockerAvailable(): boolean {
  if (process.env.TEST_DATABASE_URL) {
    return true;
  }
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `describe(name, fn)` when Docker is reachable, `describe.skip(name, fn)`
 * otherwise, so this module's docker-backed integration specs skip
 * cleanly (not fail) in an environment without Docker. Cast through
 * `unknown` because apps/web's `@types/jasmine` gets hoisted into the
 * shared root node_modules by npm workspaces and shadows @types/jest's
 * richer global `describe` type here — the runtime function (jest's)
 * does have `.skip`, the ambient type just doesn't say so.
 */
export function describeIfDocker(name: string, fn: () => void): void {
  const d = describe as unknown as typeof describe & { skip: typeof describe };
  if (isDockerAvailable()) {
    d(name, fn);
  } else {
    d.skip(name, fn);
  }
}

/**
 * Starts an ephemeral `postgres:16` container on a random local port,
 * waits for it to accept connections, and creates the `accounts` table
 * using the exact frozen DDL from this workstream's task brief (a test
 * fixture only — no migration ships this table from apps/api/src/auth/**).
 * Caller is responsible for calling `.stop()` (e.g. from `afterAll`).
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  if (process.env.TEST_DATABASE_URL) {
    return { url: process.env.TEST_DATABASE_URL, stop: () => undefined };
  }

  const port = 40000 + Math.floor(Math.random() * 20000);
  const name = `chatty-auth-test-pg-${process.pid}-${Date.now()}`;
  const user = 'app';
  const password = 'app';
  const database = 'appdb';

  execFileSync('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-e',
    `POSTGRES_USER=${user}`,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    `POSTGRES_DB=${database}`,
    '-p',
    `${port}:5432`,
    'postgres:16',
  ]);

  const stop = () => {
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    } catch {
      // best-effort cleanup
    }
  };

  const url = `postgresql://${user}:${password}@localhost:${port}/${database}`;

  const deadline = Date.now() + 60_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.query(`
        CREATE TABLE accounts (
          id serial primary key,
          email text unique not null,
          display_name text,
          google_sub text unique,
          provider text not null default 'google'
        )
      `);
      await client.end();
      return { url, stop };
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  stop();
  throw new Error(`postgres:16 test container did not become ready in time: ${String(lastErr)}`);
}
