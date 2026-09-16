import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { OpencodeModule } from '../opencode/opencode.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { TasksModule } from '../tasks/tasks.module';
import { BriefingController } from './briefing.controller';
import {
  BriefingService,
  CALENDAR_FETCHER,
  DONE_FETCHER,
  GMAIL_FETCHER,
  TASKS_FETCHER,
} from './briefing.service';
import { fetchAgendaEvents } from './calendar-source';
import { fetchRecentMail } from './gmail-source';
import { fetchCompletedToday, fetchDueTasks } from './tasks-source';

// The two source functions are injected rather than imported directly by
// BriefingService so its unit tests can substitute them without stubbing
// global fetch.
@Module({
  // TasksModule for the account's lists: both task sections read every one.
  imports: [GoogleModule, OpencodeModule, ProposalsModule, TasksModule],
  controllers: [BriefingController],
  providers: [
    BriefingService,
    { provide: CALENDAR_FETCHER, useValue: fetchAgendaEvents },
    { provide: GMAIL_FETCHER, useValue: fetchRecentMail },
    { provide: TASKS_FETCHER, useValue: fetchDueTasks },
    { provide: DONE_FETCHER, useValue: fetchCompletedToday },
  ],
})
export class BriefingModule {}
