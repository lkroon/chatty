/** Whether this account has granted the extra Calendar/Gmail scopes. */
export interface GoogleConnectionStatus {
  connected: boolean;
  /** Scopes actually granted, as returned by Google. Empty when not connected. */
  scopes: string[];
}

/** One calendar event, already narrowed to what the summary needs. */
export interface BriefingEvent {
  id: string;
  title: string;
  /** RFC3339 with offset, e.g. "2026-09-05T09:00:00+02:00". Null for all-day events. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
}

/** One mail, metadata and snippet only — never the body. */
export interface BriefingMail {
  id: string;
  from: string;
  subject: string;
  /** Google's own short preview. Truncated further by the source. */
  snippet: string;
  receivedAt: string;
}

/**
 * One section of the briefing. `status: 'error'` is normal and expected —
 * a section failing must never blank the page, so each carries its own
 * outcome rather than the whole response failing.
 */
export type BriefingSection<T> =
  | { status: 'ok'; items: T[] }
  | { status: 'error'; message: string }
  | { status: 'not_connected' };

/** Response body of `GET /api/briefing`. */
export interface Briefing {
  /** ISO date the briefing is for, in the configured timezone, e.g. "2026-09-05". */
  date: string;
  /** IANA zone the date and all times are expressed in. */
  timeZone: string;
  /** Markdown. Empty string when summarization failed; the sections still render. */
  summary: string;
  calendar: BriefingSection<BriefingEvent>;
  mail: BriefingSection<BriefingMail>;
  /** ISO timestamp this briefing was generated. */
  generatedAt: string;
}
