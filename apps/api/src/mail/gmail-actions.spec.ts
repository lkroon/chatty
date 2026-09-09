import { archiveMessage, markMessageRead } from './gmail-actions';

describe('gmail actions', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(status: number): jest.Mock {
    const mock = jest.fn().mockResolvedValue(new Response('{}', { status }));
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it('marks read by removing the UNREAD label', async () => {
    const mock = respondWith(200);
    await markMessageRead('at-1', 'm 1');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/m%201/modify');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ removeLabelIds: ['UNREAD'] });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  it('archives by removing the INBOX label, and marks read at the same time', async () => {
    const mock = respondWith(200);
    await archiveMessage('at', 'm1');

    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ removeLabelIds: ['INBOX', 'UNREAD'] });
  });

  it('treats a missing message as success', async () => {
    respondWith(404);
    await expect(markMessageRead('at', 'm1')).resolves.toBeUndefined();
    await expect(archiveMessage('at', 'm1')).resolves.toBeUndefined();
  });

  it('throws on any other failure', async () => {
    respondWith(500);
    await expect(markMessageRead('at', 'm1')).rejects.toThrow('Gmail modify failed (500)');
  });
});
