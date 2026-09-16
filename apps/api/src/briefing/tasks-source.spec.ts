import type { TaskList } from '../tasks/task-lists';
import { fetchCompletedToday, fetchDueTasks } from './tasks-source';

const DEFAULT_ONLY: TaskList[] = [{ id: '@default', title: 'My Tasks' }];
const TWO_LISTS: TaskList[] = [
  { id: 'work', title: 'Work' },
  { id: 'home', title: 'Home' },
];

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
    await fetchDueTasks('at-1', '2026-09-08', DEFAULT_ONLY);

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

    const tasks = await fetchDueTasks('at', '2026-09-08', DEFAULT_ONLY);
    // Undated last: it has no place on the day.
    expect(tasks.map((t) => t.id)).toEqual(['t2', 't1', 't3']);
    expect(tasks[0]).toEqual({
      id: 't2',
      title: 'Late',
      listId: '@default',
      listTitle: 'My Tasks',
      due: '2026-09-01',
      overdue: true,
      notes: null,
    });
    expect(tasks[1].overdue).toBe(false);
    expect(tasks[2]).toEqual({
      id: 't3',
      title: 'Someday',
      listId: '@default',
      listTitle: 'My Tasks',
      due: null,
      overdue: false,
      notes: null,
    });
  });

  it('throws on a non-ok response', async () => {
    respondWith({}, 403);
    await expect(fetchDueTasks('at', '2026-09-08', DEFAULT_ONLY)).rejects.toThrow(
      'Tasks request failed (403)',
    );
  });

  it('falls back to a placeholder title', async () => {
    respondWith({
      items: [
        { id: 't1', status: 'needsAction', due: '2026-09-08T00:00:00.000Z' },
      ],
    });
    const tasks = await fetchDueTasks('at', '2026-09-08', DEFAULT_ONLY);
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
    await fetchCompletedToday('at-1', '2026-09-16', '+02:00', DEFAULT_ONLY);

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
    const done = await fetchCompletedToday('at', '2026-09-16', '+02:00', DEFAULT_ONLY);
    expect(done).toEqual([
      {
        id: 'd2',
        title: 'Late',
        listId: '@default',
        listTitle: 'My Tasks',
        completedAt: '2026-09-16T15:30:00.000Z',
      },
      {
        id: 'd1',
        title: 'Early',
        listId: '@default',
        listTitle: 'My Tasks',
        completedAt: '2026-09-16T07:00:00.000Z',
      },
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
    const done = await fetchCompletedToday('at', '2026-09-16', '+02:00', DEFAULT_ONLY);
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
    const done = await fetchCompletedToday('at', '2026-09-16', '+02:00', DEFAULT_ONLY);
    expect(done).toHaveLength(10);
    // The cap keeps the newest, not the first ten Google happened to send.
    expect(done[0].id).toBe('d13');
  });

  it('throws on a non-ok response', async () => {
    respondWith({}, 403);
    await expect(
      fetchCompletedToday('at', '2026-09-16', '+02:00', DEFAULT_ONLY),
    ).rejects.toThrow(
      'Tasks request failed (403)',
    );
  });
});

describe('reading more than one list', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** One response per list, keyed by the list id in the path. */
  function respondPerList(byList: Record<string, unknown>, failing?: string): jest.Mock {
    const mock = jest.fn().mockImplementation((url: string) => {
      const listId = new URL(url).pathname.split('/')[4];
      if (listId === failing) {
        return Promise.resolve(new Response('{}', { status: 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(byList[listId] ?? { items: [] }), { status: 200 }),
      );
    });
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it('asks every list and labels each task with the list it came from', async () => {
    const mock = respondPerList({
      work: {
        items: [
          { id: 'w1', title: 'Mail Erna', status: 'needsAction', due: '2026-09-16T00:00:00.000Z' },
        ],
      },
      home: { items: [{ id: 'h1', title: 'Water plants', status: 'needsAction' }] },
    });

    const tasks = await fetchDueTasks('at', '2026-09-16', TWO_LISTS);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(tasks).toEqual([
      {
        id: 'w1',
        title: 'Mail Erna',
        listId: 'work',
        listTitle: 'Work',
        due: '2026-09-16',
        overdue: false,
        notes: null,
      },
      {
        id: 'h1',
        title: 'Water plants',
        listId: 'home',
        listTitle: 'Home',
        due: null,
        overdue: false,
        notes: null,
      },
    ]);
  });

  it('orders by due date across lists, not within them', async () => {
    respondPerList({
      work: {
        items: [
          { id: 'w1', title: 'Later', status: 'needsAction', due: '2026-09-16T00:00:00.000Z' },
        ],
      },
      home: {
        items: [
          { id: 'h1', title: 'Earlier', status: 'needsAction', due: '2026-09-10T00:00:00.000Z' },
        ],
      },
    });

    const tasks = await fetchDueTasks('at', '2026-09-16', TWO_LISTS);
    expect(tasks.map((t) => t.id)).toEqual(['h1', 'w1']);
  });

  it('fails the whole read when one list fails, rather than dropping its tasks', async () => {
    respondPerList({ work: { items: [] } }, 'home');
    await expect(fetchDueTasks('at', '2026-09-16', TWO_LISTS)).rejects.toThrow(
      'Tasks request failed (500)',
    );
  });

  it('caps Done today after merging, keeping the newest across lists', async () => {
    respondPerList({
      work: {
        items: Array.from({ length: 8 }, (_, i) => ({
          id: `w${i}`,
          title: `Work ${i}`,
          status: 'completed',
          completed: `2026-09-16T0${i}:00:00.000Z`,
        })),
      },
      home: {
        items: Array.from({ length: 8 }, (_, i) => ({
          id: `h${i}`,
          title: `Home ${i}`,
          status: 'completed',
          completed: `2026-09-16T1${i}:00:00.000Z`,
        })),
      },
    });

    const done = await fetchCompletedToday('at', '2026-09-16', '+02:00', TWO_LISTS);
    expect(done).toHaveLength(10);
    expect(done[0].id).toBe('h7');
    expect(done[0].listTitle).toBe('Home');
  });
});
