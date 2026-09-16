import type { TaskPayload } from './proposal-payloads';
import { createTask } from './tasks-writer';

const payload: TaskPayload = {
  title: 'Renew passport',
  due: '2026-09-30',
  notes: 'Town hall',
  listId: '@default',
  listTitle: 'My Tasks',
};

describe('createTask', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the task to the default list', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return new Response(JSON.stringify({ id: 'task-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await createTask('at-1', payload);

    expect(seenUrl).toBe('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks');
    expect((seenInit!.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
    expect(JSON.parse(String(seenInit!.body))).toEqual({
      title: 'Renew passport',
      notes: 'Town hall',
      // Tasks takes an RFC3339 timestamp but stores only the date part.
      due: '2026-09-30T00:00:00.000Z',
    });
    expect(result).toEqual({ externalId: 'task-1', link: null });
  });

  it('omits due and notes when there are none', async () => {
    let body: Record<string, unknown> = {};
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'task-2' }), { status: 200 });
    }) as unknown as typeof fetch;

    await createTask('at-1', {
      title: 'Buy milk',
      due: null,
      notes: null,
      listId: '@default',
      listTitle: 'My Tasks',
    });

    expect(body).toEqual({ title: 'Buy milk' });
  });

  it('posts to the list the card named', async () => {
    let seenUrl = '';
    global.fetch = jest.fn(async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify({ id: 'task-3' }), { status: 200 });
    }) as unknown as typeof fetch;

    await createTask('at-1', { ...payload, listId: 'MTIzNA', listTitle: 'Work' });

    expect(seenUrl).toBe('https://tasks.googleapis.com/tasks/v1/lists/MTIzNA/tasks');
  });

  /**
   * `listId: null` is the card that said "(new list)". Confirming it is the
   * only thing in the app that creates a list.
   */
  it('creates the list first when the user confirmed a new one', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string });
      if (url.includes('/users/@me/lists') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'new-1', title: 'Gardening' }), { status: 200 });
      }
      if (url.includes('/users/@me/lists')) {
        return new Response(JSON.stringify({ items: [{ id: 'work', title: 'Work' }] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ id: 'task-4' }), { status: 200 });
    }) as unknown as typeof fetch;

    await createTask('at-1', { ...payload, listId: null, listTitle: 'Gardening' });

    expect(JSON.parse(calls[1].body!)).toEqual({ title: 'Gardening' });
    expect(calls[2].url).toBe('https://tasks.googleapis.com/tasks/v1/lists/new-1/tasks');
  });

  /**
   * Minutes can pass between proposing and confirming, and the user may have
   * made the list themselves in between. A second list with the same name is
   * something nothing else would clean up.
   */
  it('reuses a list of that name if one exists by the time it is confirmed', async () => {
    const calls: { url: string; method: string }[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('/users/@me/lists')) {
        return new Response(JSON.stringify({ items: [{ id: 'g-1', title: 'Gardening' }] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ id: 'task-5' }), { status: 200 });
    }) as unknown as typeof fetch;

    await createTask('at-1', { ...payload, listId: null, listTitle: 'gardening' });

    expect(
      calls.some((call) => call.method === 'POST' && call.url.includes('/users/@me/lists')),
    ).toBe(false);
    expect(calls[1].url).toBe('https://tasks.googleapis.com/tasks/v1/lists/g-1/tasks');
  });

  it('throws on a failure without echoing the response body', async () => {
    global.fetch = jest.fn(async () =>
      new Response('{"error":{"message":"secret detail"}}', { status: 403 }),
    ) as unknown as typeof fetch;

    await expect(createTask('at-1', payload)).rejects.toThrow('Tasks create failed (403)');
  });
});
