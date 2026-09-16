import type { BriefingDoneTask, BriefingTask } from '@contracts/briefing';
import { listSegment, type TaskList } from '../tasks/task-lists';

const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists';
/** Per list, not in total: the cap has to bound each request Google gets. */
const MAX_TASKS = 100;
/** How many finished tasks the Done group shows. A sense of the day, not a log. */
const MAX_DONE = 10;

interface GoogleTask {
  id?: string;
  title?: string;
  status?: string;
  /** RFC3339, always at midnight UTC — Google Tasks stores a date, not a time. */
  due?: string;
  /** RFC3339 in UTC. Present only on a task that has been completed. */
  completed?: string;
  notes?: string;
}

/**
 * One list's tasks, under whatever filter the caller asked for.
 *
 * Every list is fetched with its own request: the Tasks API has no way to ask
 * for more than one at a time.
 */
async function fetchListTasks(
  accessToken: string,
  listId: string,
  params: URLSearchParams,
): Promise<GoogleTask[]> {
  const url = `${TASKS_URL}/${listSegment(listId)}/tasks?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Tasks request failed (${response.status})`);
  }

  const body = (await response.json()) as { items?: GoogleTask[] };
  return body.items ?? [];
}

/**
 * Fans one request out across every list, in parallel.
 *
 * A single failing list fails the whole section rather than quietly dropping
 * its tasks. A short list of things to do that is missing half of them is
 * worse than a section that says it could not be read: the first is wrong
 * without saying so, and Today is where the user decides they are finished.
 */
async function fromEveryList<T>(
  lists: TaskList[],
  read: (list: TaskList) => Promise<T[]>,
): Promise<T[]> {
  const perList = await Promise.all(lists.map(read));
  return perList.flat();
}

/**
 * Tasks due today, overdue, or undated, across every list on the account.
 *
 * Ordered soonest first, with the undated ones last — they have no place on
 * the day, so they sit below the things that do. The list a task came from is
 * carried on every row: Today shows it as the category chip, and completing
 * the task is impossible without it.
 *
 * The due filter is applied here rather than through the API's `dueMax`
 * parameter, because `dueMax`'s treatment of undated tasks is not documented
 * and undated tasks have to survive it.
 */
export async function fetchDueTasks(
  accessToken: string,
  isoDate: string,
  lists: TaskList[],
): Promise<BriefingTask[]> {
  const params = new URLSearchParams({
    showCompleted: 'false',
    showHidden: 'false',
    showDeleted: 'false',
    maxResults: String(MAX_TASKS),
  });

  const tasks = await fromEveryList(lists, async (list) => {
    const items = await fetchListTasks(accessToken, list.id, params);
    return items
      .filter((item) => item.status === 'needsAction' && !!item.id)
      .map((item) => {
        // The date component is the whole meaning of `due`; the time is always
        // midnight UTC and says nothing about the user's zone.
        const due = item.due ? item.due.slice(0, 10) : null;
        const id = item.id as string;
        return {
          id,
          title: item.title || '(no title)',
          listId: list.id,
          listTitle: list.title,
          due,
          overdue: due !== null && due < isoDate,
          notes: item.notes ?? null,
        };
      });
  });

  return (
    tasks
      .filter((task) => task.due === null || task.due <= isoDate)
      // Sorting on the raw `due` would put null first in some engines; the
      // undated ones are pushed to the end explicitly instead.
      .sort((a, b) => {
        if (a.due === null || b.due === null) {
          return a.due === b.due ? 0 : a.due === null ? 1 : -1;
        }
        return a.due.localeCompare(b.due);
      })
  );
}

/**
 * Tasks completed today, most recent first, capped at `MAX_DONE`.
 *
 * Two flags rather than one: `showCompleted` alone is not enough, because a
 * task goes `hidden` once the list is cleared, and Google's own clients pass
 * both. Without `showHidden` the group would quietly empty itself the first
 * time the user tidies up in the Tasks app.
 *
 * `completedMin` is an instant, not a date, so it takes the zone's offset at
 * local midnight — the same reasoning as the calendar window.
 */
export async function fetchCompletedToday(
  accessToken: string,
  isoDate: string,
  midnightOffset: string,
  lists: TaskList[],
): Promise<BriefingDoneTask[]> {
  const params = new URLSearchParams({
    showCompleted: 'true',
    showHidden: 'true',
    showDeleted: 'false',
    completedMin: `${isoDate}T00:00:00${midnightOffset}`,
    maxResults: String(MAX_TASKS),
  });

  const done = await fromEveryList(lists, async (list) => {
    const items = await fetchListTasks(accessToken, list.id, params);
    return items
      .filter((item) => item.status === 'completed' && !!item.completed && !!item.id)
      .map((item) => ({
        id: item.id as string,
        title: item.title || '(no title)',
        listId: list.id,
        listTitle: list.title,
        completedAt: item.completed as string,
      }));
  });

  return (
    done
      // tasks.list documents no ordering, so the sort is ours to do. Most
      // recent first: the last thing finished is the one worth seeing. The cap
      // is applied after the merge, so it bounds the group the user sees
      // rather than each list separately.
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .slice(0, MAX_DONE)
  );
}
