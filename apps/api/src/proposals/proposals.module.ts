import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { GoogleModule } from '../google/google.module';
import { ProposalsController } from './proposals.controller';
import { ProposalsRepository } from './proposals.repository';
import { ProposalsService } from './proposals.service';

// Confirm-gated writes. Exports the service (ChatModule injects it into the
// tool runtime as the ProposalToolPort) and the repository (ConversationsModule
// joins proposals onto replayed tool-call chips).
@Module({
  imports: [DbModule, GoogleModule],
  controllers: [ProposalsController],
  providers: [ProposalsRepository, ProposalsService],
  exports: [ProposalsService, ProposalsRepository],
})
export class ProposalsModule {}
