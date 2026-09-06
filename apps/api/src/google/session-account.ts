import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The logged-in account id, or 401.
 *
 * `req.session.accountId` is written by the auth module as a *string* (see
 * auth/types.d.ts) — everything downstream keys on a number, so the parse
 * happens once, here.
 */
export function requireAccountId(req: Request): number {
  const raw = req.session?.accountId;
  const parsed = Number(raw);
  if (!raw || Number.isNaN(parsed)) {
    throw new UnauthorizedException();
  }
  return parsed;
}
