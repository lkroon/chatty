import { Module } from '@nestjs/common';

// Wave 1 workstream A owns this module: POST /api/chat (SSE), reading
// req.session.accountId and calling UsageService.consume(accountId).
// Empty stub for Wave 0 — do not add real logic here.
@Module({})
export class ChatModule {}
