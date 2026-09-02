import { Module } from '@nestjs/common';
import { OpencodeModule } from '../opencode/opencode.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { DbModule } from '../db/db.module';
import { PostgresUsageService } from '../db/postgres-usage.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { CONVERSATION_STORE } from './conversation-store';
import { USAGE_SERVICE } from './in-memory-usage-service';

// Wave 1 workstream A owns this module: POST /api/chat (SSE), reading
// req.session.accountId and calling UsageService.consume(accountId).
//
// Bind the chat seams to the real Postgres-backed implementations. The
// in-memory classes remain useful for isolated unit tests but are not part
// of the production module graph.
@Module({
  imports: [OpencodeModule, ConversationsModule, DbModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: CONVERSATION_STORE, useExisting: ConversationsService },
    { provide: USAGE_SERVICE, useExisting: PostgresUsageService },
  ],
})
export class ChatModule {}
