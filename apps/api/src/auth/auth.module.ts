import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { MeRouteRegistrar } from './me-route.registrar';
import { registerGoogleStrategy } from './google.strategy';
import { pgPool } from './pg-pool';

// Google OAuth login, the ALLOWED_EMAILS allowlist gate, session
// management, and the global AuthGuard. See auth.controller.ts and
// me-route.registrar.ts for how the /auth/* vs /api/auth/me routing
// split is resolved, and auth.guard.ts for why /healthz, /readyz and
// /auth/* need an explicit guard bypass.
@Module({
  controllers: [AuthController],
  providers: [MeRouteRegistrar, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule implements OnModuleInit {
  onModuleInit(): void {
    registerGoogleStrategy(pgPool);
  }
}
