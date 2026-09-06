import type { CalendarEventPayload, WriteResult } from './proposal-payloads';

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Calendar event ids are base32hex: characters a-v and 0-9 only, 5-1024 long.
const CALENDAR_ID_PATTERN = /^[a-v0-9]{5,1024}$/;

/**
 * The proposal's own id, reused as the Calendar event id.
 *
 * This is what makes confirming twice safe end to end: Google rejects a
 * duplicate id with 409, which createCalendarEvent reads as success. A uuid's
 * hex digits are all inside base32hex once the hyphens are removed.
 */
export function calendarEventId(proposalId: string): string {
  const id = proposalId.replace(/-/g, '').toLowerCase();
  if (!CALENDAR_ID_PATTERN.test(id)) {
    throw new Error(`proposal id ${proposalId} is not usable as a Calendar event id`);
  }
  return id;
}

/** Creates one event on the primary calendar. */
export async function createCalendarEvent(
  accessToken: string,
  payload: CalendarEventPayload,
  proposalId: string,
  timeZone: string,
): Promise<WriteResult> {
  const id = calendarEventId(proposalId);
  const body: Record<string, unknown> = {
    id,
    summary: payload.title,
    // The stored times carry no offset; the zone travels beside them, which
    // is exactly the shape the Calendar API wants.
    start: { dateTime: payload.start, timeZone },
    end: { dateTime: payload.end, timeZone },
  };
  if (payload.location) {
    body.location = payload.location;
  }
  if (payload.description) {
    body.description = payload.description;
  }

  const response = await fetch(EVENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 409) {
    // The id already exists — a previous attempt succeeded. Idempotent by
    // construction, so this is a success, not a failure.
    return { externalId: id, link: null };
  }
  if (!response.ok) {
    // Never echo the body: it can quote the event, and this string is stored
    // on the row and shown to the user.
    throw new Error(`Calendar create failed (${response.status})`);
  }

  const created = (await response.json()) as { id?: string; htmlLink?: string };
  return { externalId: created.id ?? id, link: created.htmlLink ?? null };
}
