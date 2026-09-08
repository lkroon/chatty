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

  function respondWith(body: unknown, status = 200): jest.Mock {
    const mock = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
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

  it('lists unread mail from the last seven days and fetches metadata only', async () => {
    const mock = routeFetch((url) => (url.includes('/messages/m1') ? messageBody : { messages: [{ id: 'm1' }] }));
    await fetchRecentMail('at-1');

    const listUrl = new URL(mock.mock.calls[0][0] as string);
    expect(listUrl.searchParams.get('q')).toBe('is:unread newer_than:7d');

    const getUrl = new URL(mock.mock.calls[1][0] as string);
    expect(getUrl.searchParams.get('format')).toBe('metadata');
    expect(getUrl.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
  });

  it('maps a message to from/subject/snippet', async () => {
    routeFetch((url) => (url.includes('/messages/m1') ? messageBody : { messages: [{ id: 'm1' }] }));
    const result = await fetchRecentMail('at');
    expect(result.items).toEqual([
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
    const result = await fetchRecentMail('at');
    expect(result.items).toEqual([]);
  });

  it('substitutes placeholders for missing headers', async () => {
    routeFetch((url) =>
      url.includes('/messages/m1')
        ? { id: 'm1', snippet: '', internalDate: '0', payload: { headers: [] } }
        : { messages: [{ id: 'm1' }] },
    );
    const { items } = await fetchRecentMail('at');
    const [mail] = items;
    expect(mail.from).toBe('(unknown sender)');
    expect(mail.subject).toBe('(no subject)');
  });

  it('truncates a long snippet', async () => {
    routeFetch((url) =>
      url.includes('/messages/m1')
        ? { ...messageBody, snippet: 'x'.repeat(500) }
        : { messages: [{ id: 'm1' }] },
    );
    const { items } = await fetchRecentMail('at');
    const [mail] = items;
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

    const result = await fetchRecentMail('at');
    expect(result.items.map((m) => m.id)).toEqual(['m1']);
  });

  it('skips a message whose body is a 200 but not JSON', async () => {
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        url.includes('/messages/m1')
          ? new Response('<html>not json</html>', { status: 200 })
          : new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), { status: 200 }),
      ),
    ) as unknown as typeof fetch;
    const result = await fetchRecentMail('at');
    expect(result.items).toEqual([]);
  });

  it('throws when the list call itself fails', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchRecentMail('at')).rejects.toThrow(/Gmail request failed \(401\)/);
  });

  it('queries a seven-day unread window', async () => {
    const mock = respondWith({ messages: [] });
    await fetchRecentMail('at');
    const [url] = mock.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get('q')).toBe('is:unread newer_than:7d');
  });

  it('reports hasMore and trims to the cap when the window overflows', async () => {
    // 11 ids come back; MAX_MESSAGES is 10.
    const ids = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}` }));
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('?q=') || url.includes('&q=')) {
        return Promise.resolve(new Response(JSON.stringify({ messages: ids }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: 'x', snippet: 's', internalDate: '0', payload: { headers: [] } }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const result = await fetchRecentMail('at');
    expect(result.items.length).toBe(10);
    expect(result.hasMore).toBe(true);
  });

  it('does not report hasMore when the window lands exactly at the cap', async () => {
    // Exactly 10 ids come back; MAX_MESSAGES is 10.
    const ids = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` }));
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('?q=') || url.includes('&q=')) {
        return Promise.resolve(new Response(JSON.stringify({ messages: ids }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: 'x', snippet: 's', internalDate: '0', payload: { headers: [] } }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const result = await fetchRecentMail('at');
    expect(result.items.length).toBe(10);
    expect(result.hasMore).toBe(false);
  });
});
