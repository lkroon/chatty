import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { AuthUser } from '@contracts/auth';

/**
 * GET /api/auth/me cannot be expressed as a normal Nest `@Controller`
 * route given main.ts's frozen `setGlobalPrefix` exclude list. Verified
 * empirically (throwaway Nest app, three candidates tried) before
 * landing this — see workstream B's report for the transcript:
 *
 *  1. `@Controller('auth') @Get('me')` (sharing AuthController's path):
 *     Nest decides whether to add the `/api` prefix from the PRE-prefix
 *     registered route path (controller path + method path), matched
 *     against the exclude list — not from which controller declared it.
 *     `auth/me` matches the exclude pattern `/auth/{*splat}` just like
 *     `auth/google` does, so the prefix is never added: the route lands
 *     at `/auth/me`, and `/api/auth/me` 404s.
 *  2. `@Controller('api/auth') @Get('me')` (hardcoding the prefix into
 *     the controller path): `api/auth/me` does NOT match the exclude
 *     pattern, so `setGlobalPrefix` prepends `/api` on top anyway,
 *     double-prefixing to `/api/api/auth/me`. `/api/auth/me` still 404s.
 *
 * There is no controller-path split that produces exactly `/api/auth/me`
 * while `/auth/{*splat}` (which main.ts is frozen and B may not change)
 * stays a wildcard exclude — any route whose pre-prefix path is `auth/me`
 * is excluded from the prefix by definition, and any path that isn't
 * `auth/me` doesn't turn into `/api/auth/me` after prefixing.
 *
 * So instead this mounts directly on the underlying Express instance,
 * bypassing Nest's controller/prefix machinery for this one route. Also
 * verified empirically: `NestApplication#init()` runs, in order,
 * `registerRouter()` (mounts all normal `@Controller` routes) then
 * `callInitHook()` (this class's onModuleInit) then
 * `registerRouterHooks()` (mounts the catch-all 404 handler LAST) — so a
 * route added here is reachable and doesn't shadow, or get shadowed by,
 * anything else.
 *
 * One consequence: this route does NOT go through Nest's global
 * `APP_GUARD` (AuthGuard) pipeline — global guards only wrap Nest-routed
 * handlers. That's fine here since the 401-when-logged-out check this
 * route needs is simple and is done directly below.
 */
@Injectable()
export class MeRouteRegistrar implements OnModuleInit {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit(): void {
    const instance = this.adapterHost.httpAdapter.getInstance();
    instance.get('/api/auth/me', (req: Request, res: Response) => {
      if (!req.session?.accountId || !req.session.authUser) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }
      const body: AuthUser = req.session.authUser;
      res.json(body);
    });
  }
}
