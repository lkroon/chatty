import {
  BraveSearchProvider,
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
  it('defaults to searxng', () => {
    expect(createSearchProvider({} as NodeJS.ProcessEnv)).toBeInstanceOf(SearxngSearchProvider);
  });

  it('builds brave when SEARCH_PROVIDER=brave and a key is set', () => {
    expect(
      createSearchProvider({
        SEARCH_PROVIDER: 'brave',
        BRAVE_SEARCH_API_KEY: 'k',
      } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(BraveSearchProvider);
  });

  it('fails at construction time when SEARCH_PROVIDER=brave has no key', () => {
    expect(() =>
      createSearchProvider({ SEARCH_PROVIDER: 'brave' } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it('fails on an unknown SEARCH_PROVIDER value', () => {
    expect(() =>
      createSearchProvider({ SEARCH_PROVIDER: 'bing' } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
