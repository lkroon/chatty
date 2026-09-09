import type { ProposalCard } from './proposal';

/** Whether this account has granted the extra Calendar/Gmail scopes. */
export interface GoogleConnectionStatus {
  connected: boolean;
  /** Scopes actually granted, as returned by Google. Empty when not connected. */
  scopes: string[];
  /**
   * True when this connection predates a scope the app now needs. The user has
   * to run through the consent screen again; nothing is broken until they do,
   * the affected actions are simply unavailable.
   */
  needsReconnect: boolean;
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

/**
 * One task from the account's default Google Tasks list.
 *
 * Only tasks that are due today or overdue reach Today — a task with no due
 * date is parked, not pending, and an undated backlog would swamp the
 * calendar and mail it sits next to.
 */
export interface BriefingTask {
  id: string;
  title: string;
  /** `YYYY-MM-DD`. Never null: an undated task is filtered out by the source. */
  due: string;
  /** True when `due` is earlier than the briefing's `date`. */
  overdue: boolean;
  notes: string | null;
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
  /** Tasks due today or overdue, soonest first. */
  tasks: BriefingSection<BriefingTask>;
  mail: BriefingSection<BriefingMail>;
  /**
   * True when the unread window held more messages than the section shows.
   * A boolean, not a count: Gmail's list response gives no reliable total
   * for a filtered window, and an estimate that is sometimes wrong is worse
   * than "there is more".
   */
  mailHasMore: boolean;
  /**
   * Writes the model proposed that are still waiting on the user, oldest
   * first. Empty when the write tools are off, when nothing is pending, or
   * when Google is not connected. Read-only here: Today lists these and
   * points at them, but confirming still happens on the card in the
   * transcript, through POST /api/proposals/:id/confirm.
   */
  pending: ProposalCard[];
  /** ISO timestamp this briefing was generated. */
  generatedAt: string;
}

/**
 * Response body of `GET /api/briefing/items` — everything the Today screen
 * renders except the model-written summary.
 *
 * The summary is the only expensive part of a briefing (one upstream model
 * call); polling must never pay for it.
 */
export type BriefingItems = Omit<Briefing, 'summary'>;
