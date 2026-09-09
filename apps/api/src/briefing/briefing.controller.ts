import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Briefing, BriefingItems } from '@contracts/briefing';
import { BriefingService } from './briefing.service';
import { requireAccountId } from '../google/session-account';

// GET /api/briefing. Registered without the /api prefix; main.ts's
// setGlobalPrefix('api') adds it, and the global AuthGuard covers it.
@Controller('briefing')
export class BriefingController {
  constructor(private readonly briefing: BriefingService) {}

  @Get()
  async get(@Req() req: Request): Promise<Briefing> {
    const accountId = requireAccountId(req);
    // Fixed model, not the user's chat selection: the briefing is a
    // background-ish summarization job, and its cost/latency shouldn't
    // change because someone picked a bigger model for chatting.
    return this.briefing.build(
      accountId,
      process.env.BRIEFING_MODEL ?? 'glm-5.3-flash',
    );
  }

  /**
   * The cheap path — no model call. The web app polls this; only an explicit
   * Refresh, and only when the item set changed, asks for the full briefing.
   */
  @Get('items')
  async items(@Req() req: Request): Promise<BriefingItems> {
    return this.briefing.buildItems(requireAccountId(req));
  }
}
