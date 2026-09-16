const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';

/**
 * Marks one task complete on the account's default list.
 *
 * Idempotent by design, including the 404: Today renders from a cache, so the
 * UI can be behind reality, and completing something already gone must be a
 * silent success rather than an error the user has to interpret.
 */
export async function completeTask(
  accessToken: string,
  taskId: string,
): Promise<void> {
  const response = await fetch(`${TASKS_URL}/${encodeURIComponent(taskId)}`, {
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
