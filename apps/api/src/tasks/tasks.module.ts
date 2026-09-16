import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { TasksController } from './tasks.controller';
import { TaskListsService } from './task-lists.service';
import { TasksService } from './tasks.service';

// GoogleModule exports both GoogleTokenService and GoogleConnectionsRepository,
// which is everything the scope check and the write need.
@Module({
  imports: [GoogleModule],
  controllers: [TasksController],
  providers: [TasksService, TaskListsService],
  // The account's lists are chatty's categories: ProposalsModule resolves a
  // spoken name against them, ChatModule names them in the prompt, and
  // BriefingModule reads every one of them onto Today.
  exports: [TaskListsService],
})
export class TasksModule {}
