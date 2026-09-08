import { fetchDueTasks } from './tasks-source';

describe('fetchDueTasks', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(body: unknown, status = 200): jest.Mock {
    const mock = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it('asks the default list for incomplete, non-hidden, non-deleted tasks', async () => {
    const mock = respondWith({ items: [] });
    await fetchDueTasks('at-1', '2026-09-08');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/tasks/v1/lists/@default/tasks');
    expect(parsed.searchParams.get('showCompleted')).toBe('false');
    expect(parsed.searchParams.get('showHidden')).toBe('false');
    expect(parsed.searchParams.get('showDeleted')).toBe('false');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  it('keeps due-today and overdue tasks, drops undated and future ones', async () => {
    respondWith({
      items: [
        { id: 't1', title: 'Today', status: 'needsAction', due: '2026-09-08T00:00:00.000Z' },
        { id: 't2', title: 'Late', status: 'needsAction', due: '2026-09-01T00:00:00.000Z' },
        { id: 't3', title: 'Someday', status: 'needsAction' },
        { id: 't4', title: 'Next week', status: 'needsAction', due: '2026-09-20T00:00:00.000Z' },
        { id: 't5', title: 'Done', status: 'completed', due: '2026-09-08T00:00:00.000Z' },
      ],
    });

    const tasks = await fetchDueTasks('at', '2026-09-08');
    expect(tasks.map((t) => t.id)).toEqual(['t2', 't1']);
    expect(tasks[0]).toEqual({
      id: 't2',
      title: 'Late',
      due: '2026-09-01',
      overdue: true,
      notes: null,
    });
    expect(tasks[1].overdue).toBe(false);
  });

  it('throws on a non-ok response', async () => {
    respondWith({}, 403);
    await expect(fetchDueTasks('at', '2026-09-08')).rejects.toThrow('Tasks request failed (403)');
  });

  it('falls back to a placeholder title', async () => {
    respondWith({
      items: [{ id: 't1', status: 'needsAction', due: '2026-09-08T00:00:00.000Z' }],
    });
    const tasks = await fetchDueTasks('at', '2026-09-08');
    expect(tasks[0].title).toBe('(no title)');
  });
});
