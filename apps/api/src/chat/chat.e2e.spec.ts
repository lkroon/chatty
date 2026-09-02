import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { ChatModule } from './chat.module';
import { CONVERSATION_STORE } from './conversation-store';
import { InMemoryConversationStore } from './in-memory-conversation-store';
import { InMemoryUsageService, USAGE_SERVICE } from './in-memory-usage-service';

/**
 * End-to-end proof (real Node HTTP servers on both ends, no mocks) that
 * POST /chat delivers SSE progressively rather than as one buffered
 * lump, and that the wire framing matches `event: <type>\ndata:
 * <json>\n\n`. Stands in for the manual `curl -N` check described in the
 * task brief — same shape, automated so it runs with the rest of the
 * suite. This spins up a real `app.listen()`, not supertest's in-memory
 * transport, specifically so chunk-arrival timing is meaningful.
 */

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

/** POSTs and resolves with each raw chunk plus when it arrived, without
 * buffering the whole response first (unlike supertest). */
function postAndCollectChunks(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ chunks: string[]; arrivedAt: number[]; status: number }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: string[] = [];
        const arrivedAt: number[] = [];
        res.on('data', (d) => {
          chunks.push(d.toString('utf8'));
          arrivedAt.push(Date.now());
        });
        res.on('end', () =>
          resolve({ chunks, arrivedAt, status: res.statusCode ?? 0 }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('POST /chat (real HTTP end to end, fake upstream)', () => {
  it('delivers meta/delta/done as separate progressively-arriving SSE frames in our own event:/data: wire format', async () => {
    const fake = await startFakeUpstream(async (req, res) => {
      if (req.url === '/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
      );
      await sleep(25);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n`,
      );
      await sleep(25);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      res.end();
    });

    process.env.OPENCODE_BASE_URL = fake.baseUrl;
    process.env.OPENCODE_API_KEY = 'test-key';
    process.env.OPENCODE_MODELS = '';

    const moduleRef = await Test.createTestingModule({
      imports: [ChatModule],
    })
      // This test proves HTTP/SSE transport behavior without requiring the
      // integration-test Postgres harness. Production uses the Postgres
      // bindings from ChatModule itself.
      .overrideProvider(CONVERSATION_STORE)
      .useClass(InMemoryConversationStore)
      .overrideProvider(USAGE_SERVICE)
      .useClass(InMemoryUsageService)
      .compile();

    const app = moduleRef.createNestApplication<NestExpressApplication>();
    // Stand-in for express-session + workstream B's guard, neither of
    // which this module depends on directly — only req.session.accountId
    // needs to exist, per the A<->B seam in main.ts.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { session: { accountId?: string } }).session = {
        accountId: 'acct-e2e',
      };
      next();
    });
    await app.init();
    await app.listen(0);

    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const { chunks, arrivedAt, status } = await postAndCollectChunks(
        `http://127.0.0.1:${address.port}`,
        '/chat',
        { model: 'glm-5.3', content: 'hi there' },
      );

      expect(status).toBe(200);

      // Progressive delivery: at least 3 separate TCP-level chunks
      // arrived (not one buffered lump), spaced out in time matching the
      // fake upstream's staggered writes.
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(arrivedAt[arrivedAt.length - 1] - arrivedAt[0]).toBeGreaterThanOrEqual(
        40,
      );

      const full = chunks.join('');
      const frames = full
        .split('\n\n')
        .filter((f) => f.trim().length > 0)
        .map((f) => {
          const eventLine = f.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = f.split('\n').find((l) => l.startsWith('data: '));
          return {
            event: eventLine?.slice('event: '.length),
            data: JSON.parse(dataLine!.slice('data: '.length)),
          };
        });

      expect(frames).toEqual([
        {
          event: 'meta',
          data: {
            type: 'meta',
            conversationId: expect.anything(),
            messageId: expect.anything(),
          },
        },
        { event: 'delta', data: { type: 'delta', text: 'Hel' } },
        { event: 'delta', data: { type: 'delta', text: 'lo' } },
        { event: 'done', data: { type: 'done', finishReason: 'stop' } },
      ]);
    } finally {
      await app.close();
      await fake.close();
    }
  }, 15000);
});
