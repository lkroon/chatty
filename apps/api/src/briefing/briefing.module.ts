import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { OpencodeModule } from '../opencode/opencode.module';
import { BriefingController } from './briefing.controller';
import {
  BriefingService,
  CALENDAR_FETCHER,
  GMAIL_FETCHER,
} from './briefing.service';
import { fetchTodaysEvents } from './calendar-source';
import { fetchRecentMail } from './gmail-source';

// The two source functions are injected rather than imported directly by
// BriefingService so its unit tests can substitute them without stubbing
// global fetch.
@Module({
  imports: [GoogleModule, OpencodeModule],
  controllers: [BriefingController],
  providers: [
    BriefingService,
    { provide: CALENDAR_FETCHER, useValue: fetchTodaysEvents },
    { provide: GMAIL_FETCHER, useValue: fetchRecentMail },
  ],
})
export class BriefingModule {}
