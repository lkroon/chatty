import type { TaskPayload } from './proposal-payloads';
import { createTask } from './tasks-writer';

const payload: TaskPayload = { title: 'Renew passport', due: '2026-09-30', notes: 'Town hall' };

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

    await createTask('at-1', { title: 'Buy milk', due: null, notes: null });

    expect(body).toEqual({ title: 'Buy milk' });
  });

  it('throws on a failure without echoing the response body', async () => {
    global.fetch = jest.fn(async () =>
      new Response('{"error":{"message":"secret detail"}}', { status: 403 }),
    ) as unknown as typeof fetch;

    await expect(createTask('at-1', payload)).rejects.toThrow('Tasks create failed (403)');
  });
});
