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
          sessionId: 'session-1',
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
        {
          type: 'done',
          finishReason: 'stop',
          toolCalls: undefined,
          cost: null,
        },
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
        sessionId: 'session-1',
      })) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([
        { type: 'delta', text: 'Hello world' },
        {
          type: 'done',
          finishReason: 'stop',
          toolCalls: undefined,
          cost: null,
        },
      ]);
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
          sessionId: 'session-1',
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
          sessionId: 'session-1',
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
        sessionId: 'session-1',
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

  it('sends the tools array when provided, and omits the key entirely when not', async () => {
    const bodies: unknown[] = [];
    const fake = await startFakeUpstream((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        bodies.push(JSON.parse(raw));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'k');
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'web_search' as const,
            description: 'd',
            parameters: {},
          },
        },
      ];
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: 'session-1',
        tools,
      })) {
        expect(chunk).toBeDefined();
      }
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: 'session-1',
      })) {
        expect(chunk).toBeDefined();
      }
      expect(bodies[0]).toMatchObject({ tools });
      expect(bodies[1]).not.toHaveProperty('tools');
    } finally {
      await fake.close();
    }
  });

  it('reassembles a tool call streamed across six fragments into one call with the exact arguments string', async () => {
    const fake = await startFakeUpstream(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frames = [
        {
          choices: [
            {
              index: 0,
              finish_reason: null,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'web_search', arguments: '' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              finish_reason: null,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"que' } }],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              finish_reason: null,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'ry": ' } }],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              finish_reason: null,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"Hac' } }],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              finish_reason: null,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'ker"' } }],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              finish_reason: null,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '}' } }],
              },
            },
          ],
        },
        { choices: [{ index: 0, finish_reason: 'tool_calls', delta: {} }] },
      ];
      for (const frame of frames) {
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'k');
      const chunks: unknown[] = [];
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'search hacker news' }],
        sessionId: 'session-1',
      })) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([
        {
          type: 'done',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'call-1',
              name: 'web_search',
              arguments: '{"query": "Hacker"}',
            },
          ],
          cost: null,
        },
      ]);
    } finally {
      await fake.close();
    }
  });

  /**
   * The upstream's tool-call framing is not one shape. Each case below was
   * observed to silently lose calls before 2026-09-16, and every one of
   * them reached the user as a tool that "failed repeatedly": a call whose
   * arguments never arrived fails JSON.parse and surfaces as
   * "Couldn't run web_fetch", and a call that vanished entirely leaves the
   * model with nothing and no explanation.
   */
  describe('tool-call reassembly across the framings the upstream actually uses', () => {
    /** Streams `frames`, then `[DONE]`, and returns the single done chunk. */
    async function collectDone(frames: unknown[]): Promise<{
      finishReason: string;
      toolCalls?: { id: string; name: string; arguments: string }[];
    }> {
      const fake = await startFakeUpstream((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const frame of frames) {
          res.write(`data: ${JSON.stringify(frame)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
      try {
        const client = new OpencodeClient(fake.baseUrl, 'k');
        const chunks: unknown[] = [];
        for await (const chunk of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'go' }],
          sessionId: 'session-1',
        })) {
          chunks.push(chunk);
        }
        return chunks[chunks.length - 1] as never;
      } finally {
        await fake.close();
      }
    }

    function call(index: number, id: string, url: string) {
      return {
        index,
        id,
        type: 'function',
        function: { name: 'web_fetch', arguments: JSON.stringify({ url }) },
      };
    }

    it('keeps every call when one frame batches several parallel calls', async () => {
      const done = await collectDone([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  call(0, 'c1', 'https://a.example'),
                  call(1, 'c2', 'https://b.example'),
                  call(2, 'c3', 'https://c.example'),
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]);
      expect(done.toolCalls).toEqual([
        {
          id: 'c1',
          name: 'web_fetch',
          arguments: '{"url":"https://a.example"}',
        },
        {
          id: 'c2',
          name: 'web_fetch',
          arguments: '{"url":"https://b.example"}',
        },
        {
          id: 'c3',
          name: 'web_fetch',
          arguments: '{"url":"https://c.example"}',
        },
      ]);
    });

    it('keeps calls delivered in the same frame as finish_reason', async () => {
      const done = await collectDone([
        {
          choices: [
            {
              delta: { tool_calls: [call(0, 'c1', 'https://a.example')] },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]);
      expect(done.finishReason).toBe('tool_calls');
      expect(done.toolCalls).toEqual([
        {
          id: 'c1',
          name: 'web_fetch',
          arguments: '{"url":"https://a.example"}',
        },
      ]);
    });

    it('re-serializes function.arguments handed back as an object rather than a JSON string', async () => {
      const done = await collectDone([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'c1',
                    function: {
                      name: 'web_fetch',
                      arguments: { url: 'https://a.example' },
                    },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]);
      expect(done.toolCalls).toEqual([
        {
          id: 'c1',
          name: 'web_fetch',
          arguments: '{"url":"https://a.example"}',
        },
      ]);
      // The point of the case: these arguments must survive a JSON.parse,
      // which is what the tool runtime does with them.
      expect(JSON.parse(done.toolCalls![0].arguments)).toEqual({
        url: 'https://a.example',
      });
    });

    it('does not duplicate arguments when an upstream repeats entries cumulatively', async () => {
      const done = await collectDone([
        {
          choices: [
            { delta: { tool_calls: [call(0, 'c1', 'https://a.example')] } },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'c1',
                    function: { name: 'web_fetch', arguments: '' },
                  },
                  call(1, 'c2', 'https://b.example'),
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]);
      expect(done.toolCalls).toEqual([
        {
          id: 'c1',
          name: 'web_fetch',
          arguments: '{"url":"https://a.example"}',
        },
        {
          id: 'c2',
          name: 'web_fetch',
          arguments: '{"url":"https://b.example"}',
        },
      ]);
    });

    it('gives every call a distinct id when the upstream omits them', async () => {
      const done = await collectDone([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: 'web_fetch',
                      arguments: '{"url":"https://a.example"}',
                    },
                  },
                  {
                    index: 1,
                    function: {
                      name: 'web_fetch',
                      arguments: '{"url":"https://b.example"}',
                    },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]);
      const ids = done.toolCalls!.map((c) => c.id);
      expect(ids.every((id) => id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(2);
    });

    it('still yields text deltas from a frame that also carries tool calls', async () => {
      const fake = await startFakeUpstream((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Looking…' } }] })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: { tool_calls: [call(0, 'c1', 'https://a.example')] },
                finish_reason: 'tool_calls',
              },
            ],
          })}\n\n`,
        );
        res.end();
      });
      try {
        const client = new OpencodeClient(fake.baseUrl, 'k');
        const chunks: unknown[] = [];
        for await (const chunk of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'go' }],
          sessionId: 'session-1',
        })) {
          chunks.push(chunk);
        }
        expect(chunks[0]).toEqual({ type: 'delta', text: 'Looking…' });
        expect(chunks).toHaveLength(2);
      } finally {
        await fake.close();
      }
    });
  });

  it('a stream emitting finish_reason then [DONE] yields exactly one done chunk', async () => {
    const fake = await startFakeUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ choices: [] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'k');
      const chunks: unknown[] = [];
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: 'session-1',
      })) {
        chunks.push(chunk);
      }
      const doneChunks = chunks.filter(
        (c) => (c as { type: string }).type === 'done',
      );
      expect(doneChunks).toHaveLength(1);
      expect(doneChunks[0]).toEqual({
        type: 'done',
        finishReason: 'stop',
        toolCalls: undefined,
        cost: null,
      });
    } finally {
      await fake.close();
    }
  });

  it('captures a trailing cost frame that arrives after [DONE]', async () => {
    const fake = await startFakeUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ choices: [] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.write(`data: ${JSON.stringify({ choices: [], cost: '0.0042' })}\n\n`);
      res.end();
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'k');
      const chunks: unknown[] = [];
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: 'session-1',
      })) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([
        {
          type: 'done',
          finishReason: 'stop',
          toolCalls: undefined,
          cost: 0.0042,
        },
      ]);
    } finally {
      await fake.close();
    }
  });

  it('sends the session id as x-opencode-session and keeps the upstream error body', async () => {
    // The upstream rejects a completion with no session header (400
    // MissingSessionID), so the header is part of the request contract, and
    // its body is the only place the reason is stated.
    let seenHeader: string | undefined;
    const fake = await startFakeUpstream((req, res) => {
      seenHeader = req.headers['x-opencode-session'] as string | undefined;
      if (!seenHeader) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'MissingSessionID' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      res.end();
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'k');
      for await (const chunk of client.streamChatCompletion({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: 'conversation-7',
      })) {
        expect(chunk).toBeDefined();
      }
      expect(seenHeader).toBe('conversation-7');
    } finally {
      await fake.close();
    }
  });

  it('carries the upstream error body on OpencodeUpstreamError', async () => {
    const fake = await startFakeUpstream((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'MissingSessionID' } }));
    });

    try {
      const client = new OpencodeClient(fake.baseUrl, 'k');
      let caught: unknown;
      try {
        for await (const chunk of client.streamChatCompletion({
          model: 'glm-5.3',
          messages: [{ role: 'user', content: 'hi' }],
          sessionId: 'conversation-7',
        })) {
          expect(chunk).toBeDefined();
        }
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OpencodeUpstreamError);
      expect(
        (caught as InstanceType<typeof OpencodeUpstreamError>).status,
      ).toBe(400);
      expect(
        (caught as InstanceType<typeof OpencodeUpstreamError>).body,
      ).toContain('MissingSessionID');
    } finally {
      await fake.close();
    }
  });
});
