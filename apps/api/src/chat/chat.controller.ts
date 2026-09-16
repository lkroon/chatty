import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ChatRequest } from '@contracts/chat';
import { ChatService } from './chat.service';
import { formatSseEvent } from './sse.util';

const MAX_CONTENT_LENGTH = 32_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateRequest(
  body: unknown,
  isKnownModel: (model: string) => boolean,
): ChatRequest {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('request body must be an object');
  }
  const request = body as Record<string, unknown>;
  if (typeof request.content !== 'string' || !request.content.trim()) {
    throw new BadRequestException('content must be a non-empty string');
  }
  if (request.content.length > MAX_CONTENT_LENGTH) {
    throw new BadRequestException(
      `content must be at most ${MAX_CONTENT_LENGTH} characters`,
    );
  }
  if (typeof request.model !== 'string' || !isKnownModel(request.model)) {
    throw new BadRequestException('unknown model');
  }
  if (
    request.conversationId !== undefined &&
    (typeof request.conversationId !== 'string' ||
      !UUID_PATTERN.test(request.conversationId))
  ) {
    throw new BadRequestException('conversationId must be a UUID');
  }
  return request as unknown as ChatRequest;
}

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
    @Body() body: unknown,
  ): Promise<void> {
    const validated = validateRequest(body, (model) =>
      this.chatService.isKnownModel(model),
    );

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
      validated,
      (event) => {
        res.write(formatSseEvent(event));
      },
      abortController.signal,
    );

    res.end();
  }
}
