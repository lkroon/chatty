import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { Pool } from 'pg';
import type { NextFunction, Request, Response } from 'express';
import { runMigrations } from '../db/run-migrations';
import {
  describeIfDocker,
  startTestPostgres,
  TestPostgres,
} from '../db/test-postgres';
import { ConversationsModule } from './conversations.module';
import { ConversationsService } from './conversations.service';

// Unlike conversations.service.integration.spec.ts (which constructs
// ConversationsService by hand with a manually-built drizzle instance),
// this spec boots the actual Nest DI graph — ConversationsModule ->
// DbModule -> PG_POOL/DB providers — via Test.createTestingModule and
// drives it over real HTTP with supertest. This is what actually proves
// the module wiring (imports/exports/@Inject tokens) is correct, since
// tsc's type-check alone can't catch a DI graph mistake.
describeIfDocker('ConversationsModule wiring (integration)', () => {
  let pg: TestPostgres;
  let app: INestApplication;
  let accountId: number;
  let otherAccountId: number;

  beforeAll(async () => {
    pg = await startTestPostgres();
    await runMigrations(pg.url);
    process.env.DATABASE_URL = pg.url;

    const moduleRef = await Test.createTestingModule({
      imports: [ConversationsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Stand-in for the real session middleware (owned by workstream B) —
    // just enough to exercise req.session.accountId the way the
    // controller reads it.
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
      'TRUNCATE messages, conversations, accounts RESTART IDENTITY CASCADE',
    );
    const { rows } = await client.query(
      `INSERT INTO accounts (email) VALUES ('wire-a@example.com'), ('wire-b@example.com') RETURNING id`,
    );
    accountId = rows[0].id;
    otherAccountId = rows[1].id;
    await client.end();
  });

  it('GET /conversations returns 401 with no session', async () => {
    await request(app.getHttpServer()).get('/conversations').expect(401);
  });

  it('GET /conversations returns [] for an account with no conversations', async () => {
    const res = await request(app.getHttpServer())
      .get('/conversations')
      .set('x-test-account-id', String(accountId))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('GET /conversations/:id returns 404 for a conversation owned by a different account', async () => {
    const svc = app.get(ConversationsService);
    const { conversationId } = await svc.startExchange({
      accountId: String(accountId),
      model: 'm',
      userContent: 'secret',
    });

    await request(app.getHttpServer())
      .get(`/conversations/${conversationId}`)
      .set('x-test-account-id', String(otherAccountId))
      .expect(404);

    await request(app.getHttpServer())
      .get(`/conversations/${conversationId}`)
      .set('x-test-account-id', String(accountId))
      .expect(200);
  });

  it('DELETE /conversations/:id returns 204 and removes the conversation', async () => {
    const svc = app.get(ConversationsService);
    const { conversationId } = await svc.startExchange({
      accountId: String(accountId),
      model: 'm',
      userContent: 'to be deleted',
    });

    await request(app.getHttpServer())
      .delete(`/conversations/${conversationId}`)
      .set('x-test-account-id', String(accountId))
      .expect(204);

    await request(app.getHttpServer())
      .get(`/conversations/${conversationId}`)
      .set('x-test-account-id', String(accountId))
      .expect(404);
  });
});
