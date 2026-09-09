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
 * Tasks due today or overdue, on the account's default list, soonest first.
 *
 * The due filter is applied here rather than through the API's `dueMax`
 * parameter, because `dueMax`'s treatment of undated tasks is not documented
 * and this filter has to be exact: an undated task must never appear.
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
    .filter((item) => item.status === 'needsAction' && !!item.due && !!item.id)
    .map((item) => {
      // The date component is the whole meaning of `due`; the time is always
      // midnight UTC and says nothing about the user's zone.
      const due = (item.due as string).slice(0, 10);
      const id = item.id as string;
      return {
        id,
        title: item.title || '(no title)',
        due,
        overdue: due < isoDate,
        notes: item.notes ?? null,
      };
    })
    .filter((task) => task.due <= isoDate)
    .sort((a, b) => a.due.localeCompare(b.due));
}
