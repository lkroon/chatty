/**
 * The account's Google Tasks lists — chatty's categories.
 *
 * A category is not something this app stores: it *is* a task list in the
 * user's own Google account, which is why renaming one in the Tasks app
 * renames every chip here with nothing to migrate.
 */

const LISTS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';

/** Google's own cap. A user with more than this has other problems. */
const MAX_LISTS = 100;

/** One list, narrowed to the two things anything here needs. */
export interface TaskList {
  id: string;
  title: string;
}

/**
 * What a task falls back to when nothing else was asked for. `@default` is
 * an alias Google resolves to the first list, so it is always addressable
 * even before the lists have been read.
 */
export const DEFAULT_LIST_ID = '@default';

/** Every list on the account, in Google's own order (the default one first). */
export async function fetchTaskLists(accessToken: string): Promise<TaskList[]> {
  const response = await fetch(`${LISTS_URL}?maxResults=${MAX_LISTS}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Task lists request failed (${response.status})`);
  }

  const body = (await response.json()) as { items?: { id?: string; title?: string }[] };
  return (body.items ?? [])
    .filter((item) => !!item.id)
    .map((item) => ({ id: item.id as string, title: item.title || 'Untitled list' }));
}

/**
 * Creates one list and returns it.
 *
 * Only ever reached from a proposal the user confirmed: the model can ask
 * for a list that does not exist yet, but nothing creates one until the user
 * has seen its name on a card and pressed Confirm.
 */
export async function createTaskList(
  accessToken: string,
  title: string,
): Promise<TaskList> {
  const response = await fetch(LISTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(`Task list create failed (${response.status})`);
  }

  const created = (await response.json()) as { id?: string; title?: string };
  if (!created.id) {
    throw new Error('Task list create returned no id');
  }
  return { id: created.id, title: created.title || title };
}

/**
 * One list id as a URL path segment.
 *
 * `@default` is passed through unescaped: it is an alias Google reads
 * literally, and `%40default` is not documented to mean the same thing. Every
 * real id is escaped as usual.
 */
export function listSegment(listId: string): string {
  return listId === DEFAULT_LIST_ID ? DEFAULT_LIST_ID : encodeURIComponent(listId);
}

/** Case- and whitespace-insensitive, so "the work list" finds "Work ". */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Finds the list a spoken name refers to, or reports that it is ambiguous.
 *
 * Exact match first, then a unique prefix — "hol" reaches "Holiday" as long
 * as it reaches nothing else. Two candidates are never guessed between: the
 * caller turns that into a message the model retries with, because picking
 * one would write a task into a list the user never named.
 */
export type ListMatch =
  | { kind: 'matched'; list: TaskList }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: TaskList[] };

export function matchTaskList(lists: TaskList[], name: string): ListMatch {
  const wanted = normalize(name);
  if (wanted.length === 0) {
    return { kind: 'none' };
  }

  const exact = lists.filter((list) => normalize(list.title) === wanted);
  if (exact.length === 1) {
    return { kind: 'matched', list: exact[0] };
  }
  // Two lists really can share a name — Google does not enforce uniqueness.
  if (exact.length > 1) {
    return { kind: 'ambiguous', candidates: exact };
  }

  const prefixed = lists.filter((list) => normalize(list.title).startsWith(wanted));
  if (prefixed.length === 1) {
    return { kind: 'matched', list: prefixed[0] };
  }
  if (prefixed.length > 1) {
    return { kind: 'ambiguous', candidates: prefixed };
  }
  return { kind: 'none' };
}
