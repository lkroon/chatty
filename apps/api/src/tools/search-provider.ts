import { SEARCH_MAX_RESULTS, SEARCH_TIMEOUT_MS } from './tool-budget';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>;
}

/** What the model actually receives, frozen so the two providers are indistinguishable downstream. */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results. Tell the user the search found nothing rather than inventing an answer.';
  }
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
    .join('\n\n');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), SEARCH_TIMEOUT_MS);
  const onAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...init, signal: timeoutController.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * `GET ${SEARXNG_BASE_URL}/search?q=<q>&format=json&language=en&safesearch=0`.
 * Results are in `.results[]` as `{ title, url, content }` — `content` maps
 * to `snippet`. A stock SearXNG only serves HTML; `formats: [html, json]`
 * must be enabled in its `settings.yml` or every call 403s (see
 * `docs/deployment.md`).
 */
export class SearxngSearchProvider implements SearchProvider {
  constructor(private readonly baseUrl: string) {}

  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/search?${new URLSearchParams({
      q: query,
      format: 'json',
      language: 'en',
      safesearch: '0',
    })}`;
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, signal);
    if (!response.ok) {
      throw new Error(`SearXNG responded ${response.status}`);
    }
    const body = (await response.json()) as {
      results?: { title?: unknown; url?: unknown; content?: unknown }[];
    };
    const results = Array.isArray(body.results) ? body.results : [];
    return results
      .filter(
        (r): r is { title: string; url: string; content?: string } =>
          typeof r.title === 'string' && typeof r.url === 'string',
      )
      .slice(0, SEARCH_MAX_RESULTS)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
  }
}

/**
 * `GET https://api.search.brave.com/res/v1/web/search?q=<q>&count=5` with
 * headers `X-Subscription-Token` and `Accept: application/json`. Results
 * are in `.web.results[]` as `{ title, url, description }` — `description`
 * maps to `snippet`.
 */
export class BraveSearchProvider implements SearchProvider {
  private static readonly BASE_URL = 'https://api.search.brave.com/res/v1/web/search';

  constructor(private readonly apiKey: string) {}

  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const url = `${BraveSearchProvider.BASE_URL}?${new URLSearchParams({
      q: query,
      count: String(SEARCH_MAX_RESULTS),
    })}`;
    const response = await fetchWithTimeout(
      url,
      { headers: { 'X-Subscription-Token': this.apiKey, Accept: 'application/json' } },
      signal,
    );
    if (!response.ok) {
      throw new Error(`Brave Search responded ${response.status}`);
    }
    const body = (await response.json()) as {
      web?: { results?: { title?: unknown; url?: unknown; description?: unknown }[] };
    };
    const results = Array.isArray(body.web?.results) ? body.web!.results! : [];
    return results
      .filter(
        (r): r is { title: string; url: string; description?: string } =>
          typeof r.title === 'string' && typeof r.url === 'string',
      )
      .slice(0, SEARCH_MAX_RESULTS)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
  }
}

/** Builds the configured provider from env. An unknown `SEARCH_PROVIDER` value fails at boot, not at first search. */
export function createSearchProvider(env: NodeJS.ProcessEnv = process.env): SearchProvider {
  const kind = env.SEARCH_PROVIDER ?? 'searxng';
  if (kind === 'searxng') {
    return new SearxngSearchProvider(env.SEARXNG_BASE_URL ?? 'http://localhost:8080');
  }
  if (kind === 'brave') {
    if (!env.BRAVE_SEARCH_API_KEY) {
      throw new Error('SEARCH_PROVIDER=brave requires BRAVE_SEARCH_API_KEY');
    }
    return new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY);
  }
  throw new Error(`Unknown SEARCH_PROVIDER: ${kind}`);
}
