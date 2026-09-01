import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ChatRequest } from '@contracts/chat';
import { ChatService } from './chat.service';
import { formatSseEvent } from './sse.util';

// POST /api/chat (SSE) — see chat.module.ts. Registered without the /api
// prefix; app.setGlobalPrefix('api') in main.ts (owned by another
// workstream) adds it.
//
// Note: apps/api/src/conversations/session.d.ts ambiently augments
// express-session's SessionData with `accountId?: string` (declare
// module merges globally across the compilation) — no import needed
// here to get a typed req.session.accountId.
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(200)
  async chat(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: ChatRequest,
  ): Promise<void> {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disables buffering on nginx-style reverse proxies (see plan: the
      // app sits behind the cluster's reverse proxy) so SSE bytes reach
      // the client as they're written, not batched.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Abort the upstream fetch when the client disconnects mid-stream —
    // stop paying for tokens nobody will read. Guarded on writableEnded
    // so the 'close' event that fires right after our own res.end() (a
    // normal completion) doesn't get mistaken for a client abort.
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const accountId = req.session?.accountId;

    await this.chatService.run(
      accountId,
      body,
      (event) => {
        res.write(formatSseEvent(event));
      },
      abortController.signal,
    );

    res.end();
  }
}
