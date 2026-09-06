import type { BriefingEvent } from '@contracts/briefing';

const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MAX_EVENTS = 20;

interface GoogleEvent {
  id?: string;
  summary?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

function offsetAtInstant(instant: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).format(instant);
  const match = /GMT([+-]\d{2}:\d{2})/.exec(formatted);
  // Falls back to +00:00 if Intl's output doesn't parse as expected —
  // defensive, not currently reachable on this environment's ICU data.
  return match ? match[1] : '+00:00';
}

function offsetMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  return sign * (hours * 60 + minutes);
}

/**
 * The UTC offset a zone is at local midnight on a given date, as `+02:00`.
 *
 * Computed with Intl rather than hardcoded because Amsterdam is +01:00 in
 * winter and +02:00 in summer, and a briefing built with the wrong offset
 * silently shows the wrong day's events around midnight. Resolved in two
 * passes: the first treats the wall-clock date as if it were UTC to get a
 * rough offset, the second re-reads the offset at the instant that guess
 * implies — which lands on local midnight itself, so this is also correct
 * on a DST transition day where local midnight and the naive guess fall on
 * opposite sides of the transition.
 */
export function zoneOffset(isoDate: string, timeZone: string): string {
  const wallClockAsUtc = new Date(`${isoDate}T00:00:00Z`);
  const roughOffset = offsetAtInstant(wallClockAsUtc, timeZone);
  const localMidnight = new Date(wallClockAsUtc.getTime() - offsetMinutes(roughOffset) * 60_000);
  return offsetAtInstant(localMidnight, timeZone);
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Today's events on the primary calendar, in start order. */
export async function fetchTodaysEvents(
  accessToken: string,
  isoDate: string,
  timeZone: string,
): Promise<BriefingEvent[]> {
  const startOffset = zoneOffset(isoDate, timeZone);
  const endDate = nextDay(isoDate);
  const endOffset = zoneOffset(endDate, timeZone);
  const params = new URLSearchParams({
    timeMin: `${isoDate}T00:00:00${startOffset}`,
    timeMax: `${endDate}T00:00:00${endOffset}`,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(MAX_EVENTS),
  });

  const response = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Calendar request failed (${response.status})`);
  }

  const body = (await response.json()) as { items?: GoogleEvent[] };
  return (body.items ?? [])
    .filter((item) => item.status !== 'cancelled')
    .map((item) => {
      const allDay = !item.start?.dateTime;
      return {
        id: item.id ?? '',
        title: item.summary ?? '(no title)',
        start: allDay ? null : (item.start?.dateTime ?? null),
        end: allDay ? null : (item.end?.dateTime ?? null),
        allDay,
        location: item.location ?? null,
      };
    });
}
