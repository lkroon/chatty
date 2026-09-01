import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NoopAuthGuard } from './noop-auth.guard';

// Wave 1 workstream B owns this module: Passport Google OAuth strategy,
// AuthController (/auth/google, /auth/google/callback, /auth/logout,
// /api/auth/me), the allowlist check, and the global AuthGuard.
//
// The APP_GUARD provider below is the global guard registration point:
// replace NoopAuthGuard with the real AuthGuard (and delete
// noop-auth.guard.ts) when implementing this module.
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: NoopAuthGuard,
    },
  ],
})
export class AuthModule {}
