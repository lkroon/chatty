import { fetchCompletedToday, fetchDueTasks } from './tasks-source';

describe('fetchDueTasks', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(body: unknown, status = 200): jest.Mock {
    const mock = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
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
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer at-1',
    );
  });

  it('keeps due-today, overdue and undated tasks, drops future ones', async () => {
    respondWith({
      items: [
        {
          id: 't1',
          title: 'Today',
          status: 'needsAction',
          due: '2026-09-08T00:00:00.000Z',
        },
        {
          id: 't2',
          title: 'Late',
          status: 'needsAction',
          due: '2026-09-01T00:00:00.000Z',
        },
        { id: 't3', title: 'Someday', status: 'needsAction' },
        {
          id: 't4',
          title: 'Next week',
          status: 'needsAction',
          due: '2026-09-20T00:00:00.000Z',
        },
        {
          id: 't5',
          title: 'Done',
          status: 'completed',
          due: '2026-09-08T00:00:00.000Z',
        },
      ],
    });

    const tasks = await fetchDueTasks('at', '2026-09-08');
    // Undated last: it has no place on the day.
    expect(tasks.map((t) => t.id)).toEqual(['t2', 't1', 't3']);
    expect(tasks[0]).toEqual({
      id: 't2',
      title: 'Late',
      due: '2026-09-01',
      overdue: true,
      notes: null,
    });
    expect(tasks[1].overdue).toBe(false);
    expect(tasks[2]).toEqual({
      id: 't3',
      title: 'Someday',
      due: null,
      overdue: false,
      notes: null,
    });
  });

  it('throws on a non-ok response', async () => {
    respondWith({}, 403);
    await expect(fetchDueTasks('at', '2026-09-08')).rejects.toThrow(
      'Tasks request failed (403)',
    );
  });

  it('falls back to a placeholder title', async () => {
    respondWith({
      items: [
        { id: 't1', status: 'needsAction', due: '2026-09-08T00:00:00.000Z' },
      ],
    });
    const tasks = await fetchDueTasks('at', '2026-09-08');
    expect(tasks[0].title).toBe('(no title)');
  });
});

describe('fetchCompletedToday', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(body: unknown, status = 200): jest.Mock {
    const mock = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it('asks for completed AND hidden tasks since local midnight', async () => {
    const mock = respondWith({ items: [] });
    await fetchCompletedToday('at-1', '2026-09-16', '+02:00');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('showCompleted')).toBe('true');
    // Without this, the group empties itself the first time the user clears
    // their list in the Tasks app.
    expect(parsed.searchParams.get('showHidden')).toBe('true');
    expect(parsed.searchParams.get('showDeleted')).toBe('false');
    expect(parsed.searchParams.get('completedMin')).toBe('2026-09-16T00:00:00+02:00');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  it('returns the most recently finished first', async () => {
    respondWith({
      items: [
        {
          id: 'd1',
          title: 'Early',
          status: 'completed',
          completed: '2026-09-16T07:00:00.000Z',
        },
        {
          id: 'd2',
          title: 'Late',
          status: 'completed',
          completed: '2026-09-16T15:30:00.000Z',
        },
      ],
    });
    const done = await fetchCompletedToday('at', '2026-09-16', '+02:00');
    expect(done).toEqual([
      { id: 'd2', title: 'Late', completedAt: '2026-09-16T15:30:00.000Z' },
      { id: 'd1', title: 'Early', completedAt: '2026-09-16T07:00:00.000Z' },
    ]);
  });

  it('drops anything still open or missing its completion time', async () => {
    respondWith({
      items: [
        { id: 'd1', title: 'Open', status: 'needsAction' },
        { id: 'd2', title: 'No stamp', status: 'completed' },
        {
          id: 'd3',
          title: 'Done',
          status: 'completed',
          completed: '2026-09-16T09:00:00.000Z',
        },
      ],
    });
    const done = await fetchCompletedToday('at', '2026-09-16', '+02:00');
    expect(done.map((t) => t.id)).toEqual(['d3']);
  });

  it('caps the list at ten', async () => {
    respondWith({
      items: Array.from({ length: 14 }, (_, i) => ({
        id: `d${i}`,
        title: `Task ${i}`,
        status: 'completed',
        completed: `2026-09-16T${String(i + 6).padStart(2, '0')}:00:00.000Z`,
      })),
    });
    const done = await fetchCompletedToday('at', '2026-09-16', '+02:00');
    expect(done).toHaveLength(10);
    // The cap keeps the newest, not the first ten Google happened to send.
    expect(done[0].id).toBe('d13');
  });

  it('throws on a non-ok response', async () => {
    respondWith({}, 403);
    await expect(fetchCompletedToday('at', '2026-09-16', '+02:00')).rejects.toThrow(
      'Tasks request failed (403)',
    );
  });
});
