import type { ProposalKind } from '@contracts/proposal';

/**
 * Times are **local wall-clock strings with no offset**, e.g.
 * "2026-09-08T15:00:00". The zone is attached server-side at write time from
 * BRIEFING_TIMEZONE (see proposal-policy.ts) and sent to Google as
 * `{ dateTime, timeZone }`, which is exactly what the Calendar API expects.
 *
 * This removes offset arithmetic from the model's job entirely: it cannot get
 * DST wrong because it never states an offset.
 */
export interface CalendarEventPayload {
  title: string;
  start: string;
  end: string;
  location: string | null;
  description: string | null;
}

export interface TaskPayload {
  title: string;
  /** Plain date, "YYYY-MM-DD", or null. */
  due: string | null;
  notes: string | null;
}

export interface EmailPayload {
  to: string[];
  subject: string;
  body: string;
}

export type ProposalPayload = CalendarEventPayload | TaskPayload | EmailPayload;

/** What executing a proposal produced. Lives here as the counterpart of the payload. */
export interface WriteResult {
  externalId: string | null;
  link: string | null;
}

export type ValidationOutcome =
  | { ok: true; kind: ProposalKind; payload: ProposalPayload }
  | { ok: false; message: string };

const TITLE_MAX = 200;
const TEXT_MAX = 2000;
const BODY_MAX = 5000;
const MAX_RECIPIENTS = 5;
const DEFAULT_EVENT_MINUTES = 30;

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Deliberately loose: this rejects obvious nonsense so the model can correct
// itself. Gmail is the real authority on deliverability.
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TIME_FORMAT_HINT =
  'must be a local wall-clock time like 2026-09-08T15:00:00, with no timezone offset';

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

function optionalText(value: unknown, max: number): string | null {
  return value === undefined || value === null ? null : requiredText(value, max);
}

/**
 * Validates a local date-time and pads missing seconds, or returns null.
 *
 * The round-trip through Date catches dates that match the pattern but do not
 * exist (2026-02-31 silently becomes 3 March otherwise). The `Z` is only a
 * parsing device — nothing about the value is UTC.
 */
export function normalizeLocalDateTime(value: string): string | null {
  if (!LOCAL_DATE_TIME.test(value)) {
    return null;
  }
  const padded = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(`${padded}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== padded) {
    return null;
  }
  return padded;
}

/** Adds minutes to a local wall-clock string, rolling over days. */
export function addMinutes(local: string, minutes: number): string {
  const shifted = new Date(`${local}Z`);
  shifted.setUTCMinutes(shifted.getUTCMinutes() + minutes);
  return shifted.toISOString().slice(0, 19);
}

function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function invalid(message: string): ValidationOutcome {
  return { ok: false, message };
}

function validateCalendarEvent(args: Record<string, unknown>): ValidationOutcome {
  const title = requiredText(args.title, TITLE_MAX);
  if (!title) {
    return invalid(`create_calendar_event: "title" is required (1-${TITLE_MAX} characters).`);
  }

  const rawStart = typeof args.start === 'string' ? args.start.trim() : '';
  const start = normalizeLocalDateTime(rawStart);
  if (!start) {
    return invalid(`create_calendar_event: "start" ${TIME_FORMAT_HINT}.`);
  }

  let end: string;
  if (args.end === undefined || args.end === null || args.end === '') {
    end = addMinutes(start, DEFAULT_EVENT_MINUTES);
  } else {
    const normalized =
      typeof args.end === 'string' ? normalizeLocalDateTime(args.end.trim()) : null;
    if (!normalized) {
      return invalid(`create_calendar_event: "end" ${TIME_FORMAT_HINT}.`);
    }
    if (normalized <= start) {
      // Lexicographic comparison is correct here: the format is fixed-width
      // and zero-padded, so string order is chronological order.
      return invalid('create_calendar_event: "end" must be after "start".');
    }
    end = normalized;
  }

  return {
    ok: true,
    kind: 'calendar_event',
    payload: {
      title,
      start,
      end,
      location: optionalText(args.location, TEXT_MAX),
      description: optionalText(args.description, TEXT_MAX),
    },
  };
}

function validateTask(args: Record<string, unknown>): ValidationOutcome {
  const title = requiredText(args.title, TITLE_MAX);
  if (!title) {
    return invalid(`create_task: "title" is required (1-${TITLE_MAX} characters).`);
  }

  let due: string | null = null;
  if (args.due !== undefined && args.due !== null && args.due !== '') {
    const raw = typeof args.due === 'string' ? args.due.trim() : '';
    if (!LOCAL_DATE.test(raw) || !isRealDate(raw)) {
      return invalid('create_task: "due" must be a plain date in YYYY-MM-DD form.');
    }
    due = raw;
  }

  return {
    ok: true,
    kind: 'task',
    payload: { title, due, notes: optionalText(args.notes, TEXT_MAX) },
  };
}

function validateEmail(args: Record<string, unknown>): ValidationOutcome {
  const rawTo = args.to;
  const list = Array.isArray(rawTo) ? rawTo : [rawTo];
  if (list.length === 0 || list.length > MAX_RECIPIENTS) {
    return invalid(`send_email: "to" must have between 1 and ${MAX_RECIPIENTS} recipients.`);
  }

  const to: string[] = [];
  for (const entry of list) {
    const address = typeof entry === 'string' ? entry.trim() : '';
    if (!EMAIL_ADDRESS.test(address)) {
      return invalid(`send_email: "${String(entry)}" is not a valid email address.`);
    }
    to.push(address);
  }

  const subject = requiredText(args.subject, TITLE_MAX);
  if (!subject) {
    return invalid(`send_email: "subject" is required (1-${TITLE_MAX} characters).`);
  }

  const body = requiredText(args.body, BODY_MAX);
  if (!body) {
    return invalid(`send_email: "body" is required (1-${BODY_MAX} characters).`);
  }

  return { ok: true, kind: 'email', payload: { to, subject, body } };
}

/**
 * Validates one write tool's arguments into a storable payload.
 *
 * Every failure message is written for the *model* to read and retry with,
 * not for a log: it names the tool, the field, and the expected shape.
 */
export function validateProposalArguments(
  toolName: string,
  args: Record<string, unknown>,
): ValidationOutcome {
  switch (toolName) {
    case 'create_calendar_event':
      return validateCalendarEvent(args);
    case 'create_task':
      return validateTask(args);
    case 'send_email':
      return validateEmail(args);
    default:
      return invalid(`${toolName} is not a proposal tool.`);
  }
}
