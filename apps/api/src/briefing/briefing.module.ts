import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { OpencodeModule } from '../opencode/opencode.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { BriefingController } from './briefing.controller';
import {
  BriefingService,
  CALENDAR_FETCHER,
  GMAIL_FETCHER,
  TASKS_FETCHER,
} from './briefing.service';
import { fetchTodaysEvents } from './calendar-source';
import { fetchRecentMail } from './gmail-source';
import { fetchDueTasks } from './tasks-source';

// The two source functions are injected rather than imported directly by
// BriefingService so its unit tests can substitute them without stubbing
// global fetch.
@Module({
  imports: [GoogleModule, OpencodeModule, ProposalsModule],
  controllers: [BriefingController],
  providers: [
    BriefingService,
    { provide: CALENDAR_FETCHER, useValue: fetchTodaysEvents },
    { provide: GMAIL_FETCHER, useValue: fetchRecentMail },
    { provide: TASKS_FETCHER, useValue: fetchDueTasks },
  ],
})
export class BriefingModule {}
