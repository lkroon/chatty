import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Paths that must stay reachable without a session even though they are
 * routed through Nest (and therefore still hit this global APP_GUARD).
 *
 * Verified empirically that `setGlobalPrefix`'s `exclude` option only
 * controls whether `/api` gets prepended to a route's path — it has no
 * effect on whether global guards run. A throwaway Nest app confirmed a
 * global guard fires on an excluded route too (`GET /auth/google` was
 * denied by a deny-all APP_GUARD in that probe, identically to a normal
 * `/api/*` route). So this guard must exempt these routes itself:
 *
 *  - /healthz, /readyz: HealthController's liveness/readiness probes
 *    (apps/api/src/health/**, outside this module's owned paths — can't
 *    add a bypass decorator there, so it's listed here instead).
 *  - /auth/google, /auth/google/callback, /auth/logout: this module's
 *    own pre-session OAuth endpoints (AuthController) — a user hitting
 *    them by definition doesn't have a session yet.
 *
 * GET /api/auth/me is deliberately NOT listed here: it bypasses Nest
 * routing entirely (see me-route.registrar.ts) so it never reaches this
 * guard, and enforces its own 401 directly.
 */
const PUBLIC_EXACT_PATHS = new Set(['/healthz', '/readyz']);

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path;

    if (path.startsWith('/auth/') || PUBLIC_EXACT_PATHS.has(path)) {
      return true;
    }

    if (req.session?.accountId) {
      return true;
    }

    throw new UnauthorizedException();
  }
}
