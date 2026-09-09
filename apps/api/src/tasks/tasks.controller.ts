import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requireAccountId } from '../google/session-account';
import { TasksService } from './tasks.service';

/**
 * POST /api/tasks/:id/complete. Registered without the /api prefix;
 * main.ts's setGlobalPrefix('api') adds it, and the global AuthGuard covers it.
 *
 * No request body, and no discard route. Discarding a task from Today hides
 * it locally (the id lives in the browser cache): Google Tasks has no discard,
 * and deleting is irreversible with no undo to offer after a phone misclick.
 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post(':id/complete')
  @HttpCode(204)
  async complete(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.tasks.complete(requireAccountId(req), id);
  }
}
