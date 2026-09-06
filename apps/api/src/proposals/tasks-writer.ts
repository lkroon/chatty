import type { TaskPayload, WriteResult } from './proposal-payloads';

const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';

/**
 * Creates one task on the account's default list.
 *
 * There is no client-supplied id here, so a retry would create a second task —
 * which is why 'task' is not in RETRYABLE_KINDS (see proposal-policy.ts).
 */
export async function createTask(
  accessToken: string,
  payload: TaskPayload,
): Promise<WriteResult> {
  const body: Record<string, unknown> = { title: payload.title };
  if (payload.notes) {
    body.notes = payload.notes;
  }
  if (payload.due) {
    // The API accepts a full RFC3339 timestamp and then ignores the time
    // component entirely — midnight UTC is the conventional way to say
    // "this date".
    body.due = `${payload.due}T00:00:00.000Z`;
  }

  const response = await fetch(TASKS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Tasks create failed (${response.status})`);
  }

  const created = (await response.json()) as { id?: string };
  // Google Tasks has no per-task web link to hand back.
  return { externalId: created.id ?? null, link: null };
}
