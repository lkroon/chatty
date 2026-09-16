import { NotConnectedError } from '../google/errors';
import * as taskLists from './task-lists';
import { LIST_CACHE_TTL_MS, TaskListsService } from './task-lists.service';

describe('TaskListsService', () => {
  let tokens: { getAccessToken: jest.Mock };
  let fetchSpy: jest.SpyInstance;
  let service: TaskListsService;

  beforeEach(() => {
    tokens = { getAccessToken: jest.fn().mockResolvedValue('at-1') };
    fetchSpy = jest
      .spyOn(taskLists, 'fetchTaskLists')
      .mockResolvedValue([{ id: 'l1', title: 'Work' }]);
    service = new TaskListsService(tokens as never);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('reads the lists once and reuses them within the window', async () => {
    await service.lists(1, 0);
    await service.lists(1, LIST_CACHE_TTL_MS - 1);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reads them again once the window has passed', async () => {
    await service.lists(1, 0);
    await service.lists(1, LIST_CACHE_TTL_MS + 1);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caches per account, never across them', async () => {
    await service.lists(1, 0);
    await service.lists(2, 0);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('reads them again after a write invalidates the account', async () => {
    await service.lists(1, 0);
    service.invalidate(1);
    await service.lists(1, 1);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  /**
   * Not being able to name the user's categories is a worse prompt, not a
   * failed exchange — the resolver still checks whatever the model says
   * against the real lists before anything is written.
   */
  it('gives the prompt nothing rather than throwing when Google fails', async () => {
    fetchSpy.mockRejectedValue(new Error('Task lists request failed (500)'));
    await expect(service.titlesForPrompt(1)).resolves.toEqual([]);
  });

  it('gives the prompt nothing when Google was never connected', async () => {
    tokens.getAccessToken.mockRejectedValue(new NotConnectedError());
    await expect(service.titlesForPrompt(1)).resolves.toEqual([]);
  });

  it('gives the prompt the titles, in the order Google returned them', async () => {
    fetchSpy.mockResolvedValue([
      { id: 'l1', title: 'My Tasks' },
      { id: 'l2', title: 'Work' },
    ]);
    await expect(service.titlesForPrompt(1)).resolves.toEqual(['My Tasks', 'Work']);
  });
});
