import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  ConversationDetail,
  ConversationPage,
} from '@contracts/conversation';
import { ConversationsService } from './conversations.service';
// Note: session.d.ts in this directory ambiently augments express-session's
// SessionData with `accountId?: string` — no import needed, TS picks up
// .d.ts files under rootDir automatically.

// GET /api/conversations, GET /api/conversations/:id,
// DELETE /api/conversations/:id — see conversations.module.ts.
// Registered without the /api prefix; app.setGlobalPrefix('api') in
// main.ts (owned by another workstream) adds it.
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ConversationPage> {
    const accountId = this.requireAccountId(req);
    return this.conversationsService.listForAccount(accountId, {
      limit: this.parseLimit(limit),
      cursor,
    });
  }

  @Get(':id')
  async detail(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<ConversationDetail> {
    const accountId = this.requireAccountId(req);
    return this.conversationsService.getDetailForAccount(accountId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const accountId = this.requireAccountId(req);
    await this.conversationsService.deleteForAccount(accountId, id);
  }

  // A<->B seam (see main.ts): req.session.accountId is written by
  // workstream B's auth flow. With Wave 0's NoopAuthGuard, no session is
  // ever populated, so this module returns 401 for now — the guard swap
  // is workstream B's job, not this module's.
  private requireAccountId(req: Request): string {
    const accountId = req.session?.accountId;
    if (!accountId) {
      throw new UnauthorizedException();
    }
    return accountId;
  }

  // Controller owns parsing/validation of the raw query param (400 on
  // garbage); the service owns the default (30) and the hard cap (100).
  private parseLimit(raw: string | undefined): number | undefined {
    if (raw === undefined || raw === '') {
      return undefined;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }
    return parsed;
  }
}
