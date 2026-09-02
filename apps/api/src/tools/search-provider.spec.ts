import {
  BraveSearchProvider,
  DisabledSearchProvider,
  SearxngSearchProvider,
  createSearchProvider,
  formatSearchResults,
} from './search-provider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('formatSearchResults', () => {
  it('numbers results with title/url/snippet, blank line separated', () => {
    const text = formatSearchResults([
      { title: 'A', url: 'https://a.example', snippet: 'about a' },
      { title: 'B', url: 'https://b.example', snippet: 'about b' },
    ]);
    expect(text).toBe(
      '1. A\nhttps://a.example\nabout a\n\n2. B\nhttps://b.example\nabout b',
    );
  });

  it('returns the frozen no-results message for an empty list', () => {
    expect(formatSearchResults([])).toBe(
      'No results. Tell the user the search found nothing rather than inventing an answer.',
    );
  });
});

describe('SearxngSearchProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps .results[].content to snippet', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        results: [
          { title: 'Hacker News', url: 'https://news.ycombinator.com', content: 'top stories' },
        ],
      }),
    );
    const provider = new SearxngSearchProvider('http://localhost:8080');
    const results = await provider.search('hacker news', new AbortController().signal);
    expect(results).toEqual([
      { title: 'Hacker News', url: 'https://news.ycombinator.com', snippet: 'top stories' },
    ]);
  });

  it('returns an empty array for a zero-result response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ results: [] }));
    const provider = new SearxngSearchProvider('http://localhost:8080');
    const results = await provider.search('nothing matches this', new AbortController().signal);
    expect(results).toEqual([]);
  });

  it('throws on a 5xx response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 503));
    const provider = new SearxngSearchProvider('http://localhost:8080');
    await expect(provider.search('q', new AbortController().signal)).rejects.toThrow();
  });
});

describe('BraveSearchProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps .web.results[].description to snippet and sends the subscription header', async () => {
    let capturedHeaders: HeadersInit | undefined;
    jest.spyOn(global, 'fetch').mockImplementation(((url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return Promise.resolve(
        jsonResponse({
          web: { results: [{ title: 'Result', url: 'https://x.example', description: 'desc' }] },
        }),
      );
    }) as typeof fetch);
    const provider = new BraveSearchProvider('brave-key');
    const results = await provider.search('q', new AbortController().signal);
    expect(results).toEqual([{ title: 'Result', url: 'https://x.example', snippet: 'desc' }]);
    expect((capturedHeaders as Record<string, string>)['X-Subscription-Token']).toBe('brave-key');
  });

  it('returns an empty array for a zero-result response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ web: { results: [] } }));
    const provider = new BraveSearchProvider('brave-key');
    const results = await provider.search('q', new AbortController().signal);
    expect(results).toEqual([]);
  });

  it('throws on a 5xx response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 500));
    const provider = new BraveSearchProvider('brave-key');
    await expect(provider.search('q', new AbortController().signal)).rejects.toThrow();
  });
});

describe('createSearchProvider', () => {
  const enabled = (extra: Record<string, string> = {}) =>
    ({ WEB_SEARCH_ENABLED: 'true', ...extra }) as NodeJS.ProcessEnv;

  it('defaults to searxng', () => {
    expect(createSearchProvider(enabled())).toBeInstanceOf(SearxngSearchProvider);
  });

  it('builds brave when SEARCH_PROVIDER=brave and a key is set', () => {
    expect(
      createSearchProvider(enabled({ SEARCH_PROVIDER: 'brave', BRAVE_SEARCH_API_KEY: 'k' })),
    ).toBeInstanceOf(BraveSearchProvider);
  });

  it('fails at construction time when SEARCH_PROVIDER=brave has no key', () => {
    expect(() => createSearchProvider(enabled({ SEARCH_PROVIDER: 'brave' }))).toThrow();
  });

  it('fails on an unknown SEARCH_PROVIDER value', () => {
    expect(() => createSearchProvider(enabled({ SEARCH_PROVIDER: 'bing' }))).toThrow();
  });

  describe('when web search is off', () => {
    // The chart's default posture: search disabled, provider still nominally
    // brave, no key anywhere. This combination crash-looped the pod on kind.
    const off = { SEARCH_PROVIDER: 'brave' } as NodeJS.ProcessEnv;

    it('does not validate provider config the app will never use', () => {
      expect(() => createSearchProvider(off)).not.toThrow();
      expect(createSearchProvider(off)).toBeInstanceOf(DisabledSearchProvider);
    });

    it('ignores an unknown SEARCH_PROVIDER too', () => {
      expect(
        createSearchProvider({ SEARCH_PROVIDER: 'bing' } as NodeJS.ProcessEnv),
      ).toBeInstanceOf(DisabledSearchProvider);
    });

    it('rejects loudly if anything ever does reach it', async () => {
      await expect(
        createSearchProvider(off).search('anything', new AbortController().signal),
      ).rejects.toThrow(/disabled/);
    });
  });
});
