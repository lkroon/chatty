import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// Wave 1 workstream C: GET /api/conversations, GET /api/conversations/:id,
// DELETE /api/conversations/:id. ConversationsService also exposes
// startExchange/finalizeAssistantMessage, structurally matching
// workstream A's ConversationStore seam — see conversations.service.ts.
// EmbeddingsModule supplies the EMBEDDER seam for the best-effort
// message-embedding write path (Feature B).
@Module({
  imports: [DbModule, EmbeddingsModule, ProposalsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
