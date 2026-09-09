import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

// GoogleModule exports both GoogleTokenService and GoogleConnectionsRepository,
// which is everything the scope check and the write need.
@Module({
  imports: [GoogleModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
