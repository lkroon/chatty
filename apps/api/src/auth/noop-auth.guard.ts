import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

// Placeholder for workstream B's real AuthGuard (session + allowlist
// check). Always allows requests through — Wave 0 has no auth yet.
// Replace this class (or the APP_GUARD registration in auth.module.ts
// that wires it up) with the real guard.
@Injectable()
export class NoopAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
