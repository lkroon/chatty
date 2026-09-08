import { ForbiddenException } from '@nestjs/common';
import { NotConnectedError } from '../google/errors';
import { completeTask } from './tasks-actions';
import { TasksService } from './tasks.service';

jest.mock('./tasks-actions');

const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject');
}

describe('TasksService', () => {
  let tokens: { getAccessToken: jest.Mock };
  let connections: { find: jest.Mock };
  let service: TasksService;
  const completeTaskMock = completeTask as jest.Mock;

  beforeEach(() => {
    tokens = { getAccessToken: jest.fn() };
    connections = { find: jest.fn() };
    completeTaskMock.mockReset();
    service = new TasksService(tokens as never, connections as never);
  });

  it('completes the task once scope and token checks pass', async () => {
    connections.find.mockResolvedValue({ accountId: 7, refreshTokenSealed: 'x', scopes: [TASKS_SCOPE] });
    tokens.getAccessToken.mockResolvedValue('at-1');
    completeTaskMock.mockResolvedValue(undefined);

    await service.complete(7, 't1');

    expect(completeTaskMock).toHaveBeenCalledWith('at-1', 't1');
  });

  it('refuses with google_not_connected when there is no connection', async () => {
    connections.find.mockResolvedValue(null);

    const err = await captureRejection(service.complete(7, 't1'));

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe('google_not_connected');
    expect(tokens.getAccessToken).not.toHaveBeenCalled();
    expect(completeTaskMock).not.toHaveBeenCalled();
  });

  it('refuses with google_scope_missing when the tasks scope was not granted', async () => {
    connections.find.mockResolvedValue({
      accountId: 7,
      refreshTokenSealed: 'x',
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const err = await captureRejection(service.complete(7, 't1'));

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe('google_scope_missing');
    expect(tokens.getAccessToken).not.toHaveBeenCalled();
    expect(completeTaskMock).not.toHaveBeenCalled();
  });

  it('translates a NotConnectedError from getAccessToken into google_not_connected', async () => {
    connections.find.mockResolvedValue({ accountId: 7, refreshTokenSealed: 'x', scopes: [TASKS_SCOPE] });
    tokens.getAccessToken.mockRejectedValue(new NotConnectedError());

    const err = await captureRejection(service.complete(7, 't1'));

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe('google_not_connected');
    expect(completeTaskMock).not.toHaveBeenCalled();
  });

  it('lets any other getAccessToken error propagate unchanged', async () => {
    connections.find.mockResolvedValue({ accountId: 7, refreshTokenSealed: 'x', scopes: [TASKS_SCOPE] });
    tokens.getAccessToken.mockRejectedValue(new Error('boom'));

    const err = await captureRejection(service.complete(7, 't1'));

    expect(err).not.toBeInstanceOf(ForbiddenException);
    expect((err as Error).message).toBe('boom');
    expect(completeTaskMock).not.toHaveBeenCalled();
  });

  it('checks the scope before ever calling getAccessToken', async () => {
    connections.find.mockResolvedValue({ accountId: 7, refreshTokenSealed: 'x', scopes: [TASKS_SCOPE] });
    tokens.getAccessToken.mockResolvedValue('at-1');
    completeTaskMock.mockResolvedValue(undefined);

    await service.complete(7, 't1');

    // connections.find (and the scope check derived from it) is invoked
    // strictly before getAccessToken is ever called.
    expect(connections.find.mock.invocationCallOrder[0]).toBeLessThan(
      tokens.getAccessToken.mock.invocationCallOrder[0],
    );
  });
});
