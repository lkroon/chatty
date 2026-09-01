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

describe('OpencodeClient (against a real fake-upstream HTTP server)', () => {
  it('streams delta chunks progressively as separate frames arrive, then a done chunk', async () => {
    const seenAt: number[] = [];
    const fake = await startFakeUpstream(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
      );
      await sleep(20);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n`,
      );
      await sleep(20);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
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
        seenAt.push(Date.now());
      }

      expect(chunks).toEqual([
        { type: 'delta', text: 'Hel' },
        { type: 'delta', text: 'lo' },
        { type: 'done', finishReason: 'stop' },
      ]);
      // Progressive framing, not one lump: consecutive chunks arrived
      // measurably apart, matching the server's staggered writes.
      expect(seenAt[1] - seenAt[0]).toBeGreaterThanOrEqual(10);
      expect(seenAt[2] - seenAt[1]).toBeGreaterThanOrEqual(10);
    } finally {
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
        for await (const _ of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          // no-op
        }
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OpencodeUpstreamError);
      expect((caught as InstanceType<typeof OpencodeUpstreamError>).status).toBe(
        429,
      );
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
        for await (const _ of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          // no-op
        }
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OpencodeUpstreamError);
      expect((caught as InstanceType<typeof OpencodeUpstreamError>).status).toBe(
        500,
      );
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
      for await (const _ of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        // no-op
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
