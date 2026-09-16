import {
  DEFAULT_LIST_ID,
  createTaskList,
  fetchTaskLists,
  listSegment,
  matchTaskList,
} from '../tasks/task-lists';
import type { TaskPayload, WriteResult } from './proposal-payloads';

const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists';

/**
 * Creates one task, on the list the user confirmed.
 *
 * There is no client-supplied id here, so a retry would create a second task —
 * which is why 'task' is not in RETRYABLE_KINDS (see proposal-policy.ts).
 */
export async function createTask(
  accessToken: string,
  payload: TaskPayload,
): Promise<WriteResult> {
  const listId = await resolveListId(accessToken, payload);

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

  const response = await fetch(`${TASKS_URL}/${listSegment(listId)}/tasks`, {
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

/**
 * The list id to write to, creating the list if that is what was confirmed.
 *
 * `listId: null` means the card said "(new list)", so this is the only place
 * in the app that creates one — reached only from a confirmed proposal.
 *
 * The lists are re-read first rather than trusting the null: minutes can pass
 * between proposing and confirming, and the user may well have made that list
 * themselves in the meantime. Reusing it keeps a confirmed card from
 * producing a second list with the same name, which nothing else would clean
 * up.
 */
async function resolveListId(accessToken: string, payload: TaskPayload): Promise<string> {
  if (payload.listId !== null) {
    return payload.listId;
  }
  if (!payload.listTitle) {
    return DEFAULT_LIST_ID;
  }

  const lists = await fetchTaskLists(accessToken);
  const match = matchTaskList(lists, payload.listTitle);
  if (match.kind === 'matched') {
    return match.list.id;
  }

  const created = await createTaskList(accessToken, payload.listTitle);
  return created.id;
}
