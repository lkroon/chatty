import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod } from '@nestjs/common';
import * as session from 'express-session';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Must run BEFORE the session middleware below: the app sits behind the
  // cluster's reverse proxy, so Express needs to trust its X-Forwarded-*
  // headers for req.secure / the secure cookie flag to work correctly.
  app.set('trust proxy', 1);

  app.use(
    session({
      // AUTH-STORE: no `store` option set below, so express-session falls
      // back to its default in-memory MemoryStore (dev-only — leaks
      // memory and doesn't survive a restart or work across replicas).
      // Workstream B replaces this with a Postgres-backed store
      // (connect-pg-simple, `createTableIfMissing: true` — no migration
      // ships the `session` table) by adding a `store:` option here.
      secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // COOKIE_SECURE env var: bool, default true; set to the literal
        // string 'false' only for local http development.
        secure: process.env.COOKIE_SECURE !== 'false',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // placeholder — workstream B owns final cookie settings
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

  // NEVER add app.use(compression()) here (or anywhere else in this
  // project) — it buffers responses and breaks SSE streaming for
  // POST /api/chat. Hard rule, not just a Wave 0 placeholder.

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
