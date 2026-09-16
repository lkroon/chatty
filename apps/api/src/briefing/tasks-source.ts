import type { BriefingTask } from '@contracts/briefing';

const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';
const MAX_TASKS = 100;

interface GoogleTask {
  id?: string;
  title?: string;
  status?: string;
  /** RFC3339, always at midnight UTC — Google Tasks stores a date, not a time. */
  due?: string;
  notes?: string;
}

/**
 * Tasks due today, overdue, or undated, on the account's default list.
 *
 * Ordered soonest first, with the undated ones last — they have no place on
 * the day, so they sit below the things that do.
 *
 * The due filter is applied here rather than through the API's `dueMax`
 * parameter, because `dueMax`'s treatment of undated tasks is not documented
 * and undated tasks have to survive it.
 */
export async function fetchDueTasks(
  accessToken: string,
  isoDate: string,
): Promise<BriefingTask[]> {
  const params = new URLSearchParams({
    showCompleted: 'false',
    showHidden: 'false',
    showDeleted: 'false',
    maxResults: String(MAX_TASKS),
  });

  const response = await fetch(`${TASKS_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Tasks request failed (${response.status})`);
  }

  const body = (await response.json()) as { items?: GoogleTask[] };
  return (body.items ?? [])
    .filter((item) => item.status === 'needsAction' && !!item.id)
    .map((item) => {
      // The date component is the whole meaning of `due`; the time is always
      // midnight UTC and says nothing about the user's zone.
      const due = item.due ? item.due.slice(0, 10) : null;
      const id = item.id as string;
      return {
        id,
        title: item.title || '(no title)',
        due,
        overdue: due !== null && due < isoDate,
        notes: item.notes ?? null,
      };
    })
    .filter((task) => task.due === null || task.due <= isoDate)
    // Sorting on the raw `due` would put null first in some engines; the
    // undated ones are pushed to the end explicitly instead.
    .sort((a, b) => {
      if (a.due === null || b.due === null) {
        return a.due === b.due ? 0 : a.due === null ? 1 : -1;
      }
      return a.due.localeCompare(b.due);
    });
}
