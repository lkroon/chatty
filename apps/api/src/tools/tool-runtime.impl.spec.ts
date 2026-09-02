import { ToolRuntimeImpl } from './tool-runtime.impl';
import { ToolBudget } from './tool-budget';
import type { SearchProvider, SearchResult } from './search-provider';

function fakeProvider(fn: (query: string) => Promise<SearchResult[]>): SearchProvider {
  return { search: (query) => fn(query) };
}

describe('ToolRuntimeImpl', () => {
  it('definitions() returns the frozen web_search/web_fetch schemas', () => {
    const runtime = new ToolRuntimeImpl(fakeProvider(async () => []));
    const names = runtime.definitions().map((d) => d.function.name);
    expect(names).toEqual(['web_search', 'web_fetch']);
  });

  it('web_search: dispatches the parsed query and formats a done result', async () => {
    let seenQuery: string | undefined;
    const runtime = new ToolRuntimeImpl(
      fakeProvider(async (query) => {
        seenQuery = query;
        return [{ title: 'T', url: 'https://x.example', snippet: 'S' }];
      }),
    );
    const result = await runtime.execute(
      { name: 'web_search', rawArguments: JSON.stringify({ query: 'hacker news' }) },
      new ToolBudget(),
      new AbortController().signal,
    );
    expect(seenQuery).toBe('hacker news');
    expect(result.status).toBe('done');
    expect(result.label).toBe('Searched "hacker news"');
    expect(result.sources).toEqual([{ title: 'T', url: 'https://x.example' }]);
    expect(result.content).toContain('T');
  });

  it('web_search: a provider throw becomes a failed result, not a thrown error', async () => {
    const runtime = new ToolRuntimeImpl(
      fakeProvider(async () => {
        throw new Error('provider unreachable');
      }),
    );
    const result = await runtime.execute(
      { name: 'web_search', rawArguments: JSON.stringify({ query: 'q' }) },
      new ToolBudget(),
      new AbortController().signal,
    );
    expect(result.status).toBe('failed');
    expect(result.content).toContain('provider unreachable');
  });

  it('unparseable rawArguments yields a failed result rather than throwing', async () => {
    const runtime = new ToolRuntimeImpl(fakeProvider(async () => []));
    const result = await runtime.execute(
      { name: 'web_search', rawArguments: '{not json' },
      new ToolBudget(),
      new AbortController().signal,
    );
    expect(result.status).toBe('failed');
  });

  it('an unknown tool name yields a failed result rather than throwing', async () => {
    const runtime = new ToolRuntimeImpl(fakeProvider(async () => []));
    const result = await runtime.execute(
      { name: 'delete_everything', rawArguments: '{}' },
      new ToolBudget(),
      new AbortController().signal,
    );
    expect(result.status).toBe('failed');
    expect(result.content).toContain('Unknown tool');
  });

  it('truncates a done result against the shared char budget', async () => {
    const runtime = new ToolRuntimeImpl(
      fakeProvider(async () => [{ title: 'T', url: 'https://x.example', snippet: 'a very long snippet' }]),
    );
    const budget = new ToolBudget();
    budget.charsRemaining = 5;
    const result = await runtime.execute(
      { name: 'web_search', rawArguments: JSON.stringify({ query: 'q' }) },
      budget,
      new AbortController().signal,
    );
    expect(result.content.length).toBe(5);
    expect(budget.charsRemaining).toBe(0);
  });
});
