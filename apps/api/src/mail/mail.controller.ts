import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requireAccountId } from '../google/session-account';
import { MailService } from './mail.service';

/**
 * POST /api/mail/:id/read and /:id/archive. Registered without the /api
 * prefix; main.ts's setGlobalPrefix('api') adds it, and the global AuthGuard
 * covers both.
 *
 * **Neither handler reads a request body, and neither goes through the
 * proposals gate.** That gate exists because a *model* proposed the write and
 * mail content is untrusted input to it. Here the input is a person's tap on a
 * message id they can see on their own screen, carried by their own session
 * cookie — there is no model in the path, and nothing to confirm that the tap
 * did not already say.
 *
 * The invariant that keeps this true: these routes must never be added to
 * tools/tool-definitions.ts or tools/proposal-tool-definitions.ts.
 * mail.controller.spec.ts asserts it.
 */
@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Post(':id/read')
  @HttpCode(204)
  async read(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.mail.markRead(requireAccountId(req), id);
  }

  @Post(':id/archive')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.mail.archive(requireAccountId(req), id);
  }
}
