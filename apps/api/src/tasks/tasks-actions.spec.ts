import { completeTask } from './tasks-actions';

describe('completeTask', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(status: number): jest.Mock {
    const mock = jest.fn().mockResolvedValue(new Response('{}', { status }));
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it('patches the task to completed on the default list', async () => {
    const mock = respondWith(200);
    await completeTask('at-1', 't 1');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/t%201',
    );
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'completed' });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer at-1',
    );
  });

  it('treats a missing task as success', async () => {
    respondWith(404);
    await expect(completeTask('at', 't1')).resolves.toBeUndefined();
  });

  it('throws on any other failure', async () => {
    respondWith(500);
    await expect(completeTask('at', 't1')).rejects.toThrow(
      'Tasks complete failed (500)',
    );
  });
});
