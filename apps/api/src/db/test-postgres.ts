import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

export interface TestPostgres {
  url: string;
  stop: () => void;
}

/**
 * `describe(name, fn)` when Docker is reachable, `describe.skip(name, fn)`
 * otherwise — so integration specs that need a real postgres:16 container
 * skip cleanly (not fail) in an environment without Docker.
 *
 * Typed as `unknown as ... & { skip: ... }` because apps/web's
 * @types/jasmine (a legitimate Angular/Karma devDependency) gets hoisted
 * into the shared root node_modules by npm workspaces and shadows
 * @types/jest's global `describe` type here (apps/api's tsconfig has no
 * `types` restriction to prevent it) — jasmine's simpler `describe` type
 * has no `.skip`, even though the actual runtime function (jest's) does.
 */
export function describeIfDocker(name: string, fn: () => void): void {
  const d = describe as unknown as typeof describe & {
    skip: typeof describe;
  };
  if (isDockerAvailable()) {
    d(name, fn);
  } else {
    d.skip(name, fn);
  }
}

/** True if a `docker` binary is reachable. Used by describeIfDocker above
 * (also exported for callers that need the check directly). */
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
 * Starts an ephemeral `postgres:16` container on a random local port and
 * waits for it to accept connections. Each call gets its own uniquely
 * named, `--rm` container so this workstream's integration tests never
 * collide with another workstream's own Postgres containers running
 * concurrently on the same dev host / CI runner.
 *
 * Caller is responsible for calling `.stop()` (e.g. from `afterAll`).
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  if (process.env.TEST_DATABASE_URL) {
    return { url: process.env.TEST_DATABASE_URL, stop: () => undefined };
  }

  const port = 40000 + Math.floor(Math.random() * 20000);
  const name = `chatty-test-pg-${process.pid}-${Date.now()}`;
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
      await client.end();
      return { url, stop };
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  stop();
  throw new Error(
    `postgres:16 test container did not become ready in time: ${String(lastErr)}`,
  );
}
