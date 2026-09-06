import { fetchRecentMail } from './gmail-source';

describe('fetchRecentMail', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function routeFetch(handler: (url: string) => unknown): jest.Mock {
    const mock = jest.fn((url: string) =>
      Promise.resolve(new Response(JSON.stringify(handler(url)), { status: 200 })),
    );
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  const messageBody = {
    id: 'm1',
    snippet: 'Hello there',
    internalDate: '1757060000000',
    payload: {
      headers: [
        { name: 'From', value: 'Alice <alice@example.com>' },
        { name: 'Subject', value: 'Lunch?' },
      ],
    },
  };

  it('lists unread mail from the last day and fetches metadata only', async () => {
    const mock = routeFetch((url) => (url.includes('/messages/m1') ? messageBody : { messages: [{ id: 'm1' }] }));
    await fetchRecentMail('at-1');

    const listUrl = new URL(mock.mock.calls[0][0] as string);
    expect(listUrl.searchParams.get('q')).toBe('is:unread newer_than:1d');

    const getUrl = new URL(mock.mock.calls[1][0] as string);
    expect(getUrl.searchParams.get('format')).toBe('metadata');
    expect(getUrl.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
  });

  it('maps a message to from/subject/snippet', async () => {
    routeFetch((url) => (url.includes('/messages/m1') ? messageBody : { messages: [{ id: 'm1' }] }));
    await expect(fetchRecentMail('at')).resolves.toEqual([
      {
        id: 'm1',
        from: 'Alice <alice@example.com>',
        subject: 'Lunch?',
        snippet: 'Hello there',
        receivedAt: new Date(1757060000000).toISOString(),
      },
    ]);
  });

  it('returns an empty list when nothing matches', async () => {
    routeFetch(() => ({}));
    await expect(fetchRecentMail('at')).resolves.toEqual([]);
  });

  it('substitutes placeholders for missing headers', async () => {
    routeFetch((url) =>
      url.includes('/messages/m1')
        ? { id: 'm1', snippet: '', internalDate: '0', payload: { headers: [] } }
        : { messages: [{ id: 'm1' }] },
    );
    const [mail] = await fetchRecentMail('at');
    expect(mail.from).toBe('(unknown sender)');
    expect(mail.subject).toBe('(no subject)');
  });

  it('truncates a long snippet', async () => {
    routeFetch((url) =>
      url.includes('/messages/m1')
        ? { ...messageBody, snippet: 'x'.repeat(500) }
        : { messages: [{ id: 'm1' }] },
    );
    const [mail] = await fetchRecentMail('at');
    expect(mail.snippet.length).toBeLessThanOrEqual(200);
  });

  it('skips a message whose detail fetch fails rather than failing the section', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/messages/m2')) {
        return Promise.resolve(new Response('{}', { status: 500 }));
      }
      if (url.includes('/messages/m1')) {
        return Promise.resolve(new Response(JSON.stringify(messageBody), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ messages: [{ id: 'm1' }, { id: 'm2' }] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const mail = await fetchRecentMail('at');
    expect(mail.map((m) => m.id)).toEqual(['m1']);
  });

  it('skips a message whose body is a 200 but not JSON', async () => {
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        url.includes('/messages/m1')
          ? new Response('<html>not json</html>', { status: 200 })
          : new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), { status: 200 }),
      ),
    ) as unknown as typeof fetch;
    await expect(fetchRecentMail('at')).resolves.toEqual([]);
  });

  it('throws when the list call itself fails', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchRecentMail('at')).rejects.toThrow(/Gmail request failed \(401\)/);
  });
});
