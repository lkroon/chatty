import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

function contextFor(path: string, session: Record<string, unknown> | undefined): ExecutionContext {
  const req = { path, session };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const guard = new AuthGuard();

  it('allows a request with a session accountId', () => {
    expect(guard.canActivate(contextFor('/api/conversations', { accountId: '42' }))).toBe(true);
  });

  it('401s (throws UnauthorizedException) when there is no session', () => {
    expect(() => guard.canActivate(contextFor('/api/conversations', undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('401s when the session exists but has no accountId', () => {
    expect(() => guard.canActivate(contextFor('/api/conversations', {}))).toThrow(
      UnauthorizedException,
    );
  });

  it.each(['/auth/google', '/auth/google/callback', '/auth/logout'])(
    'allows %s through without a session (pre-login route)',
    (path) => {
      expect(guard.canActivate(contextFor(path, undefined))).toBe(true);
    },
  );

  it.each(['/healthz', '/readyz'])('allows %s through without a session (probe route)', (path) => {
    expect(guard.canActivate(contextFor(path, undefined))).toBe(true);
  });

  it('does not treat an unrelated path merely starting with "/auth" as exempt', () => {
    // '/authorize' starts with '/auth' but not '/auth/' — must still require a session.
    expect(() => guard.canActivate(contextFor('/authorize', undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
