import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  EmbeddingClient,
  EmbeddingUpstreamError,
} from './embedding-client';

/** Starts a throwaway HTTP server and returns its base URL + a closer. */
async function startFakeUpstream(
  handler: http.RequestListener,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Same fixture pattern as opencode-client.spec.ts: a real (throwaway) HTTP
// server, so the client's fetch behavior — headers, body, status mapping —
// is what's actually exercised.
describe('EmbeddingClient (against a real fake-upstream HTTP server)', () => {
  it('sends the OpenAI shape and Authorization header, and returns one vector per input', async () => {
    let capturedAuth: string | undefined;
    let capturedBody = '';
    const fake = await startFakeUpstream((req, res) => {
      capturedAuth = req.headers['authorization'];
      req.on('data', (d) => (capturedBody += d));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { embedding: [0.1, 0.2] },
              { embedding: [0.3, 0.4] },
            ],
          }),
        );
      });
    });

    try {
      const client = new EmbeddingClient(fake.baseUrl, 'test-key');
      const vectors = await client.embed({
        model: 'gemini-embedding-001',
        input: ['one', 'two'],
        dimensions: 1536,
      });

      expect(vectors).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
      expect(capturedAuth).toBe('Bearer test-key');
      expect(JSON.parse(capturedBody)).toEqual({
        model: 'gemini-embedding-001',
        input: ['one', 'two'],
        dimensions: 1536,
      });
    } finally {
      await fake.close();
    }
  });

  it('maps a non-200 response to EmbeddingUpstreamError with status and body', async () => {
    const fake = await startFakeUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate limited' }));
    });

    try {
      const client = new EmbeddingClient(fake.baseUrl, 'k');
      let caught: unknown;
      try {
        await client.embed({
          model: 'm',
          input: ['hi'],
          dimensions: 1536,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EmbeddingUpstreamError);
      expect((caught as EmbeddingUpstreamError).status).toBe(429);
      expect((caught as EmbeddingUpstreamError).body).toContain(
        'rate limited',
      );
    } finally {
      await fake.close();
    }
  });

  it('rejects a response whose data array does not line up with the inputs', async () => {
    const fake = await startFakeUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Two inputs, one vector — silently accepting this would attach the
      // wrong embedding to every message after the first.
      res.end(JSON.stringify({ data: [{ embedding: [0.1] }] }));
    });

    try {
      const client = new EmbeddingClient(fake.baseUrl, 'k');
      let caught: unknown;
      try {
        await client.embed({
          model: 'm',
          input: ['one', 'two'],
          dimensions: 1536,
        });
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).message).toContain('mismatched response');
    } finally {
      await fake.close();
    }
  });

  it('rejects invalid JSON with our own sentence, not a JSON.parse stack', async () => {
    const fake = await startFakeUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not json');
    });

    try {
      const client = new EmbeddingClient(fake.baseUrl, 'k');
      let caught: unknown;
      try {
        await client.embed({ model: 'm', input: ['hi'], dimensions: 1536 });
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).message).toContain('invalid JSON');
    } finally {
      await fake.close();
    }
  });
});
