import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ProposalCard } from '@contracts/proposal';
import { ProposalsService } from './proposals.service';
// Note: apps/api/src/conversations/session.d.ts ambiently augments
// express-session's SessionData with `accountId?: string` (declare module
// merges globally across the compilation) — no import needed here.

/**
 * POST /api/proposals/:id/confirm and /:id/discard.
 *
 * **Neither handler reads a request body, and neither ever will.** The
 * proposal id in the path plus the session cookie are the whole input; the
 * service re-reads the row from Postgres and executes that. If the payload
 * travelled in the body, a compromised model could render one thing on the
 * card and send another — the injection would have moved rather than closed.
 *
 * These are ordinary `/api` routes, so the global AuthGuard already requires
 * a session; the explicit check here is what turns `accountId` into a number
 * and refuses a malformed one.
 */
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@Req() req: Request, @Param('id') id: string): Promise<ProposalCard> {
    return this.proposals.confirm(requireAccountId(req), id);
  }

  @Post(':id/discard')
  @HttpCode(200)
  async discard(@Req() req: Request, @Param('id') id: string): Promise<ProposalCard> {
    return this.proposals.discard(requireAccountId(req), id);
  }
}

function requireAccountId(req: Request): number {
  const raw = req.session?.accountId;
  const parsed = Number(raw);
  if (!raw || Number.isNaN(parsed)) {
    throw new UnauthorizedException();
  }
  return parsed;
}
