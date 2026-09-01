import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod } from '@nestjs/common';
import * as session from 'express-session';
import * as ConnectPgSimple from 'connect-pg-simple';
import { AppModule } from './app.module';
import { pgPool } from './auth/pg-pool';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Must run BEFORE the session middleware below: the app sits behind the
  // cluster's reverse proxy, so Express needs to trust its X-Forwarded-*
  // headers for req.secure / the secure cookie flag to work correctly.
  app.set('trust proxy', 1);

  const PgSession = ConnectPgSimple(session);
  app.use(
    session({
      // Postgres-backed store (default `session` table, created on boot
      // if missing) so a pod restart or a second replica doesn't log
      // users out. `pgPool` is shared with the `accounts` upsert query —
      // see apps/api/src/auth/pg-pool.ts.
      store: new PgSession({ pool: pgPool, createTableIfMissing: true }),
      name: 'opencode-chat.sid',
      secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true, // 30-day rolling: every response resets the cookie's Max-Age
      cookie: {
        httpOnly: true,
        // COOKIE_SECURE env var: bool, default true; set to the literal
        // string 'false' only for local http development.
        secure: process.env.COOKIE_SECURE !== 'false',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // A<->B seam: after login, workstream B writes the authenticated
  // account's id onto the session as `req.session.accountId` (a string).
  // Workstream A reads it (never writes it) inside the chat controller to
  // key UsageService.consume(accountId) — see
  // libs/contracts/src/usage-service.ts. B owns writing it; A only reads it.

  // Global guard registration point: src/auth/auth.module.ts registers a
  // NoopAuthGuard as APP_GUARD (always allows requests) for Wave 0.
  // Workstream B swaps it there for the real session/allowlist AuthGuard.

  // Do not enable response compression here (or anywhere else in this
  // project): it buffers responses and breaks SSE streaming for POST /api/chat.

  app.setGlobalPrefix('api', {
    // /healthz and /readyz are unauthenticated probes with no /api
    // prefix. /auth/* (GET /auth/google, /auth/google/callback,
    // POST /auth/logout) are the OAuth redirect endpoints and are also
    // registered outside /api — only GET /api/auth/me lives under the
    // prefix. This keeps main.ts stable: workstream B's AuthController
    // routes resolve correctly without editing this exclude list.
    exclude: [
      { path: 'healthz', method: RequestMethod.GET },
      { path: 'readyz', method: RequestMethod.GET },
      { path: '/auth/{*splat}', method: RequestMethod.ALL },
    ],
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
