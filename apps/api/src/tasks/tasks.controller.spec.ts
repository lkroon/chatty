import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TOOL_DEFINITIONS } from '../tools/tool-definitions';
import { TasksController } from './tasks.controller';

function req(accountId?: string): Request {
  return { session: accountId ? { accountId } : {} } as unknown as Request;
}

describe('TasksController', () => {
  let service: { complete: jest.Mock };
  let controller: TasksController;

  beforeEach(() => {
    service = { complete: jest.fn().mockResolvedValue(undefined) };
    controller = new TasksController(service as never);
  });

  it('completes the task for the session account', async () => {
    await controller.complete(req('7'), 't1');
    expect(service.complete).toHaveBeenCalledWith(7, 't1');
  });

  it('refuses a request with no session account', async () => {
    await expect(controller.complete(req(), 't1')).rejects.toThrow(UnauthorizedException);
  });

  it('surfaces a missing scope as Forbidden', async () => {
    service.complete.mockRejectedValue(new ForbiddenException('google_scope_missing'));
    await expect(controller.complete(req('7'), 't1')).rejects.toThrow(ForbiddenException);
  });

  /**
   * The whole point of a direct route: it is reachable by a person's tap and
   * by nothing else. If a task tool is ever added upstream, this fails.
   */
  it('is not exposed to the model as a tool', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.function.name)).toEqual(['web_search', 'web_fetch']);
  });
});
