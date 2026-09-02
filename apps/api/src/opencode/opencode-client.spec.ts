import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpencodeClient } from './opencode-client';
import { OpencodeUpstreamError } from './opencode-client.types';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A promise plus the handle that settles it, for cross-task handshakes. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('OpencodeClient (against a real fake-upstream HTTP server)', () => {
  it('streams delta chunks progressively as separate frames arrive, then a done chunk', async () => {
    // The upstream writes each frame only once the consumer has taken the
    // previous chunk, so the handshake — not a wall-clock gap — is what proves
    // progressive delivery. A client that buffered the whole body before
    // yielding would never release these gates and would stall instead.
    const consumed = [deferred(), deferred()];
    const fake = await startFakeUpstream(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
      );
      await consumed[0].promise;
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n`,
      );
      await consumed[1].promise;
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      res.end();
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'test-key');
      const chunks: unknown[] = [];
      const drain = (async () => {
        for await (const chunk of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          chunks.push(chunk);
          consumed[chunks.length - 1]?.resolve();
        }
        return 'drained' as const;
      })();

      let stallTimer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        drain,
        new Promise<'stalled'>((resolve) => {
          stallTimer = setTimeout(() => resolve('stalled'), 5000);
        }),
      ]).finally(() => clearTimeout(stallTimer));

      expect(outcome).toBe('drained');
      expect(chunks).toEqual([
        { type: 'delta', text: 'Hel' },
        { type: 'delta', text: 'lo' },
        { type: 'done', finishReason: 'stop' },
      ]);
    } finally {
      // Release any gate the client never reached, so the handler can finish
      // and the server can close even when the assertions above failed.
      consumed.forEach((gate) => gate.resolve());
      await fake.close();
    }
  });

  it('reassembles a frame the fake upstream deliberately splits mid `data:` line', async () => {
    const fake = await startFakeUpstream(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const full = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello world' } }] })}\n\n`;
      const splitAt = full.indexOf('"content"') + 5; // land mid data: line
      res.write(full.slice(0, splitAt));
      await sleep(15);
      res.write(full.slice(splitAt));
      res.end();
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'test-key');
      const chunks: unknown[] = [];
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([{ type: 'delta', text: 'Hello world' }]);
    } finally {
      await fake.close();
    }
  });

  it('maps a 429 upstream response to OpencodeUpstreamError with status 429', async () => {
    const fake = await startFakeUpstream((req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate limited' }));
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'test-key');
      let caught: unknown;
      try {
        for await (const chunk of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          expect(chunk).toBeDefined();
        }
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OpencodeUpstreamError);
      expect(
        (caught as InstanceType<typeof OpencodeUpstreamError>).status,
      ).toBe(429);
    } finally {
      await fake.close();
    }
  });

  it('maps a 500 upstream response to OpencodeUpstreamError with status 500', async () => {
    const fake = await startFakeUpstream((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('boom');
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'test-key');
      let caught: unknown;
      try {
        for await (const chunk of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          expect(chunk).toBeDefined();
        }
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OpencodeUpstreamError);
      expect(
        (caught as InstanceType<typeof OpencodeUpstreamError>).status,
      ).toBe(500);
    } finally {
      await fake.close();
    }
  });

  it('sends the Authorization header and request body the plan documents', async () => {
    let capturedAuth: string | undefined;
    let capturedBody = '';
    const fake = await startFakeUpstream((req, res) => {
      capturedAuth = req.headers['authorization'];
      req.on('data', (d) => (capturedBody += d));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'secret-key');
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        expect(chunk).toBeDefined();
      }
      expect(capturedAuth).toBe('Bearer secret-key');
      expect(JSON.parse(capturedBody)).toEqual({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });
    } finally {
      await fake.close();
    }
  });
});
