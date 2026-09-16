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

/**
 * How many days the agenda covers, starting with today.
 *
 * Shared because both sides have to agree: the API asks Google for exactly
 * this window, and the web renders a group per day in it — including a day
 * the window covers but no event falls on.
 */
export const AGENDA_DAY_COUNT = 3;

/** One calendar event, already narrowed to what the summary needs. */
export interface BriefingEvent {
  id: string;
  title: string;
  /**
   * `YYYY-MM-DD`, the local day this event is shown under. Always one of the
   * `AGENDA_DAY_COUNT` days from the briefing's `date`: an event that began
   * before the window (a multi-day all-day event) is clamped to its first day.
   */
  date: string;
  /** RFC3339 with offset, e.g. "2026-09-05T09:00:00+02:00". Null for all-day events. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
}

/**
 * One task from any of the account's Google Tasks lists.
 *
 * Tasks due today, overdue, or undated reach Today. A future-dated task does
 * not: it belongs to the day it is due. Undated tasks are included because
 * most tasks added from chat never get a due date, and a task the user cannot
 * see on Today is a task they will not do.
 */
export interface BriefingTask {
  id: string;
  title: string;
  /**
   * The Google task list this task lives on. Needed to complete it: the
   * Tasks API addresses a task as list + id, and an id is only unique
   * within its list.
   */
  listId: string;
  /** The list's own name, shown as the row's category chip. */
  listTitle: string;
  /** `YYYY-MM-DD`, or null for a task with no due date. */
  due: string | null;
  /** True when `due` is set and earlier than the briefing's `date`. */
  overdue: boolean;
  notes: string | null;
}

/**
 * One task finished today, for the "Done today" group.
 *
 * Deliberately not a `BriefingTask`: nothing here is actionable. There is no
 * due date to show, no tick to complete and no dismiss — it is a record of
 * something already done, and the only thing it carries beyond its title is
 * when it happened.
 */
export interface BriefingDoneTask {
  id: string;
  title: string;
  /** The list it was finished on, carried for the same reason as on BriefingTask. */
  listId: string;
  listTitle: string;
  /** RFC3339 in UTC, as Google records it. Rendered in the briefing's zone. */
  completedAt: string;
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
  /** Events across the agenda window, in start order. Group by `date`. */
  calendar: BriefingSection<BriefingEvent>;
  /** Tasks due today, overdue or undated. Dated first, soonest first. */
  tasks: BriefingSection<BriefingTask>;
  /** What was finished today, most recent first. Capped, and never empty-padded. */
  doneToday: BriefingSection<BriefingDoneTask>;
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
