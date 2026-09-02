import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// Wave 1 workstream C: GET /api/conversations, GET /api/conversations/:id,
// DELETE /api/conversations/:id. ConversationsService also exposes
// startExchange/finalizeAssistantMessage, structurally matching
// workstream A's ConversationStore seam — see conversations.service.ts.
@Module({
  imports: [DbModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
