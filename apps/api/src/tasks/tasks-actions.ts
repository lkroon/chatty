import { listSegment } from './task-lists';

const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists';

/**
 * Marks one task complete on the list it lives on.
 *
 * Idempotent by design, including the 404: Today renders from a cache, so the
 * UI can be behind reality, and completing something already gone must be a
 * silent success rather than an error the user has to interpret.
 *
 * `listId` is not optional and does not default. A task id is only unique
 * within its list, and addressing every tick at @default is how a task on any
 * other list gets a 404 this function then swallows — a tick that looks like
 * it worked and changed nothing.
 */
export async function completeTask(
  accessToken: string,
  listId: string,
  taskId: string,
): Promise<void> {
  const url = `${TASKS_URL}/${listSegment(listId)}/tasks/${encodeURIComponent(taskId)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    // The completion stamp is sent rather than left to Google. The Done
    // today group reads `completed` back and filters on it, and a task the
    // user ticked off here has to appear in it — this is the one thing that
    // makes that independent of whether the API stamps it for us.
    body: JSON.stringify({ status: 'completed', completed: new Date().toISOString() }),
  });

  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Tasks complete failed (${response.status})`);
  }
}
