import { Module } from '@nestjs/common';
import { ModelsController } from './models.controller';
import { OpencodeService } from './opencode.service';

// Wave 1 workstream A owns this module: the OpenCode upstream client
// (OPENCODE_API_KEY, OPENCODE_BASE_URL, OPENCODE_MODELS) and GET /api/models.
// OpencodeService is exported so ChatModule can inject it directly (no DI
// token needed — unlike ConversationStore/UsageService, there's no
// alternate implementation to swap in later).
@Module({
  controllers: [ModelsController],
  providers: [OpencodeService],
  exports: [OpencodeService],
})
export class OpencodeModule {}
