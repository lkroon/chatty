import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import type { NextFunction, Request, Response } from 'express';
import { runMigrations } from '../db/run-migrations';
import {
  describeIfDocker,
  startTestPostgres,
  TestPostgres,
} from '../db/test-postgres';
import { disabledEmbedder, keywordEmbedder, oneHot } from '../embeddings/fake-embedder';
import { EMBEDDER } from '../embeddings/embeddings.service';
import { toVectorLiteral } from './vector-literal';
import { SearchModule } from './search.module';
import { SearchService } from './search.service';

// Integration test against a real, ephemeral pgvector container: seeded
// conversations + one-hot embeddings + a fake embedder for the query side,
// so ranking is asserted deterministically with zero network. Same
// shared-matcher discipline as conversations.service.integration.spec.ts
// (see the note there for why).

async function expectToReject(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject, but it resolved');
}

// 'alpha' → one-hot 0, 'beta' → one-hot 1, 'gamma' → one-hot 2 — both the
// seeded rows and the runtime query embedding come from this mapping.
const fakeEmbedder = keywordEmbedder(['alpha', 'beta', 'gamma']);

interface SeededMessage {
  messageId: string;
  conversationId: string;
}

/** One conversation with one user message, optionally pre-embedded. */
async function seedMessage(
  pool: Pool,
  accountId: number,
  title: string,
  content: string,
  keywordIndex: number | null,
): Promise<SeededMessage> {
  const conv = await pool.query<{ id: string }>(
    `insert into conversations (account_id, title, model) values ($1, $2, 'm') returning id`,
    [accountId, title],
  );
  const msg = await pool.query<{ id: string }>(
    `insert into messages (conversation_id, role, content, model) values ($1, 'user', $2, 'm') returning id`,
    [conv.rows[0].id, content],
  );
  if (keywordIndex !== null) {
    await pool.query(
      `insert into message_embeddings (message_id, embedding, model) values ($1, $2::vector, 'fake-embedding-model')`,
      [msg.rows[0].id, toVectorLiteral(oneHot(keywordIndex))],
    );
  }
  return { messageId: msg.rows[0].id, conversationId: conv.rows[0].id };
}

describeIfDocker('SearchService (integration)', () => {
  let pg: TestPostgres;
  let pool: Pool;
  let service: SearchService;
  let accountAId: number;
  let accountBId: number;

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    pool = new Pool({ connectionString: pg.url });
    service = new SearchService(drizzle(pool, { schema }), fakeEmbedder);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.stop();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE message_embeddings, messages, conversations, accounts RESTART IDENTITY CASCADE',
    );
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO accounts (email) VALUES ('a@example.com'), ('b@example.com') RETURNING id`,
    );
    accountAId = rows[0].id;
    accountBId = rows[1].id;
  });

  it('ranks the semantically closest message first with a full SearchHit shape', async () => {
    const alpha = await seedMessage(pool, accountAId, 'Alpha chat', 'all about alpha', 0);
    const beta = await seedMessage(pool, accountAId, 'Beta chat', 'mostly beta', 1);

    const hits = await service.search(String(accountAId), 'alpha things');
    expect(hits.length).toBe(2);
    expect(hits[0].messageId).toBe(alpha.messageId);
    expect(hits[0].conversationId).toBe(alpha.conversationId);
    expect(hits[0].conversationTitle).toBe('Alpha chat');
    expect(hits[0].role).toBe('user');
    expect(hits[0].snippet).toBe('all about alpha');
    // Same keyword = orthogonal one-hots = cosine distance 0 = score 1.
    expect(hits[0].score).toBeCloseTo(1, 5);
    // Different keyword = distance 1 = score 0, and ranked second.
    expect(hits[1].messageId).toBe(beta.messageId);
    expect(hits[1].score).toBeCloseTo(0, 5);
    expect(hits[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never returns another account's messages", async () => {
    const mine = await seedMessage(pool, accountAId, 'Mine', 'alpha for me', 0);
    const theirs = await seedMessage(pool, accountBId, 'Theirs', 'alpha for them', 0);

    const hits = await service.search(String(accountAId), 'alpha');
    expect(hits.map((hit) => hit.messageId)).toEqual([mine.messageId]);
    expect(hits.some((hit) => hit.messageId === theirs.messageId)).toBe(false);
  });

  it('snippets long content to the first 200 characters', async () => {
    const long = 'x'.repeat(300) + ' alpha';
    const seeded = await seedMessage(pool, accountAId, 'Long chat', long, 0);

    const hits = await service.search(String(accountAId), 'alpha');
    expect(hits[0].messageId).toBe(seeded.messageId);
    expect(hits[0].snippet.length).toBe(200);
    expect(hits[0].snippet).toBe('x'.repeat(200));
  });

  it('returns an empty array when the account has no embedded messages', async () => {
    await seedMessage(pool, accountBId, 'Theirs', 'alpha for them', 0);
    const hits = await service.search(String(accountAId), 'alpha');
    expect(hits).toEqual([]);
  });

  it('refuses with ServiceUnavailableException when embeddings are not configured', async () => {
    const unconfigured = new SearchService(
      drizzle(pool, { schema }),
      disabledEmbedder(),
    );
    const err = await expectToReject(unconfigured.search(String(accountAId), 'alpha'));
    expect(err).toBeInstanceOf(ServiceUnavailableException);
  });
});

describeIfDocker('SearchModule wiring (integration)', () => {
  let pg: TestPostgres;
  let app: INestApplication;
  let accountId: number;

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    process.env.DATABASE_URL = pg.url;

    const moduleRef = await Test.createTestingModule({
      imports: [SearchModule],
    })
      // The module's own EMBEDDER binding reads real env (absent in CI) —
      // the wiring test swaps in the deterministic fake instead, so what is
      // proven here is the DI graph and the route, not the provider.
      .overrideProvider(EMBEDDER)
      .useValue(fakeEmbedder)
      .compile();

    app = moduleRef.createNestApplication();
    // Same stand-in as the conversations wiring spec: just enough session
    // middleware for req.session.accountId.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const header = req.headers['x-test-account-id'];
      Object.defineProperty(req, 'session', {
        value: header ? { accountId: String(header) } : {},
        writable: true,
      });
      next();
    });
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  beforeEach(async () => {
    const client = new Pool({ connectionString: pg.url });
    await client.query(
      'TRUNCATE message_embeddings, messages, conversations, accounts RESTART IDENTITY CASCADE',
    );
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO accounts (email) VALUES ('search-a@example.com') RETURNING id`,
    );
    accountId = rows[0].id;
    await seedMessage(client, accountId, 'Alpha chat', 'all about alpha', 0);
    await client.end();
  });

  it('GET /search returns 401 with no session', async () => {
    await request(app.getHttpServer()).get('/search?q=alpha').expect(401);
  });

  it('GET /search returns 400 without a q parameter', async () => {
    await request(app.getHttpServer())
      .get('/search')
      .set('x-test-account-id', String(accountId))
      .expect(400);
    await request(app.getHttpServer())
      .get('/search?q=%20%20')
      .set('x-test-account-id', String(accountId))
      .expect(400);
  });

  it('GET /search?q= returns the ranked hits for the session account', async () => {
    const res = await request(app.getHttpServer())
      .get('/search?q=alpha')
      .set('x-test-account-id', String(accountId))
      .expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].conversationTitle).toBe('Alpha chat');
    expect(res.body[0].snippet).toBe('all about alpha');
    expect(res.body[0].score).toBeCloseTo(1, 5);
  });
});
