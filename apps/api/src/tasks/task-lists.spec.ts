import { createTaskList, fetchTaskLists, listSegment, matchTaskList } from './task-lists';

const LISTS = [
  { id: 'l1', title: 'Work' },
  { id: 'l2', title: 'Holiday' },
  { id: 'l3', title: 'Home' },
];

describe('fetchTaskLists', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns id and title for every list', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({ items: [{ id: 'l1', title: 'Work', kind: 'tasks#taskList' }] }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    await expect(fetchTaskLists('at-1')).resolves.toEqual([{ id: 'l1', title: 'Work' }]);
  });

  it('names an untitled list rather than rendering an empty chip', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: 'l1' }] }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(fetchTaskLists('at-1')).resolves.toEqual([
      { id: 'l1', title: 'Untitled list' },
    ]);
  });

  it('throws on a non-ok response', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(fetchTaskLists('at-1')).rejects.toThrow('Task lists request failed (403)');
  });
});

describe('createTaskList', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the title and returns the created list', async () => {
    let seenInit: RequestInit | undefined;
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      seenInit = init;
      return new Response(JSON.stringify({ id: 'new-1', title: 'Gardening' }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(createTaskList('at-1', 'Gardening')).resolves.toEqual({
      id: 'new-1',
      title: 'Gardening',
    });
    expect(JSON.parse(String(seenInit!.body))).toEqual({ title: 'Gardening' });
  });

  it('throws when the response carries no id, rather than writing into nowhere', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ title: 'Gardening' }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(createTaskList('at-1', 'Gardening')).rejects.toThrow('no id');
  });
});

describe('matchTaskList', () => {
  it('matches exactly, ignoring case and surrounding space', () => {
    expect(matchTaskList(LISTS, '  work ')).toEqual({ kind: 'matched', list: LISTS[0] });
  });

  it('matches a unique prefix', () => {
    expect(matchTaskList(LISTS, 'hol')).toEqual({ kind: 'matched', list: LISTS[1] });
  });

  it('reports a prefix that fits more than one list', () => {
    const result = matchTaskList(LISTS, 'ho');
    expect(result.kind).toBe('ambiguous');
  });

  it('reports two lists that really do share a name', () => {
    const twins = [
      { id: 'a', title: 'Work' },
      { id: 'b', title: 'work' },
    ];
    expect(matchTaskList(twins, 'Work').kind).toBe('ambiguous');
  });

  it('finds nothing for a name no list has', () => {
    expect(matchTaskList(LISTS, 'Gardening')).toEqual({ kind: 'none' });
  });

  it('finds nothing for an empty name', () => {
    expect(matchTaskList(LISTS, '   ')).toEqual({ kind: 'none' });
  });
});

describe('listSegment', () => {
  /**
   * `%40default` is not documented to mean the same thing to Google as
   * `@default`, and this alias is the one every account starts on.
   */
  it('leaves the @default alias alone', () => {
    expect(listSegment('@default')).toBe('@default');
  });

  it('escapes anything else', () => {
    expect(listSegment('a/b c')).toBe('a%2Fb%20c');
  });
});
