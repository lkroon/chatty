import type { ProposalCard, ProposalField, ProposalStatus } from '@contracts/proposal';
import type {
  CalendarEventPayload,
  EmailPayload,
  TaskPayload,
} from './proposal-payloads';
import { EXECUTING_STALE_MS, RETRYABLE_KINDS, proposalTtlMs } from './proposal-policy';
import type { ProposalRow } from './proposal-row';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MESSAGE_PREVIEW_MAX = 300;

/**
 * Formats a local wall-clock string. Intl is deliberately not used: the value
 * carries no zone, and handing a naive string to a zone-aware formatter is how
 * a 15:00 appointment becomes 17:00 on the card but 15:00 in the calendar.
 * Parsing the digits and printing them back cannot shift anything.
 */
function formatDatePart(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const weekday = DAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

function formatDateTime(local: string): string {
  return `${formatDatePart(local.slice(0, 10))}, ${local.slice(11, 16)}`;
}

function formatRange(start: string, end: string): string {
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  return sameDay
    ? `${formatDateTime(start)} – ${end.slice(11, 16)}`
    : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function calendarFields(payload: CalendarEventPayload): ProposalField[] {
  const fields: ProposalField[] = [
    { label: 'When', value: formatRange(payload.start, payload.end) },
  ];
  if (payload.location) {
    fields.push({ label: 'Where', value: payload.location });
  }
  if (payload.description) {
    fields.push({ label: 'Notes', value: truncate(payload.description, MESSAGE_PREVIEW_MAX) });
  }
  return fields;
}

function taskFields(payload: TaskPayload): ProposalField[] {
  const fields: ProposalField[] = [
    { label: 'Due', value: payload.due ? formatDatePart(payload.due) : 'No due date' },
  ];
  if (payload.notes) {
    fields.push({ label: 'Notes', value: truncate(payload.notes, MESSAGE_PREVIEW_MAX) });
  }
  return fields;
}

/**
 * The email body is **never** truncated.
 *
 * This is the one field where the plan's central claim — the card shows what
 * will be sent — has to hold literally: a preview that stops at 300 characters
 * is a card the user cannot actually check. The card scrolls the value instead
 * (see proposal-card.ts on the web side). Notes and descriptions elsewhere are
 * still previewed, because nothing is sent to a third party on their strength.
 */
function emailFields(payload: EmailPayload): ProposalField[] {
  return [
    { label: 'To', value: payload.to.join(', ') },
    { label: 'Message', value: payload.body },
  ];
}

/**
 * Builds the card for one row, deriving the two states that are not stored:
 * a pending row past its TTL is 'expired', and a row left 'executing' by a
 * dead process is 'failed'.
 */
export function toProposalCard(row: ProposalRow, now: Date = new Date()): ProposalCard {
  let status: ProposalStatus = row.status;
  let error = row.error;

  // The TTL runs from creation and binds every confirmable state, not just
  // 'pending'. claimForExecution enforces the same window in SQL, so a retry
  // offered past it would be a button that answers 409 — the card must not
  // promise what the row will refuse.
  const withinTtl = now.getTime() - row.createdAt.getTime() <= proposalTtlMs();

  if (row.status === 'pending' && !withinTtl) {
    status = 'expired';
  } else if (
    row.status === 'executing' &&
    now.getTime() - row.updatedAt.getTime() > EXECUTING_STALE_MS
  ) {
    status = 'failed';
    error = error ?? 'Interrupted before it finished.';
  }

  let title: string;
  let fields: ProposalField[];
  if (row.kind === 'calendar_event') {
    const payload = row.payload as CalendarEventPayload;
    title = payload.title;
    fields = calendarFields(payload);
  } else if (row.kind === 'task') {
    const payload = row.payload as TaskPayload;
    title = payload.title;
    fields = taskFields(payload);
  } else {
    const payload = row.payload as EmailPayload;
    title = payload.subject;
    fields = emailFields(payload);
  }

  return {
    id: row.id,
    kind: row.kind,
    status,
    title,
    fields,
    link: row.externalLink,
    error,
    confirmable:
      status === 'pending' ||
      (status === 'failed' && withinTtl && RETRYABLE_KINDS.has(row.kind)),
    // Only a pending row has a deadline left. A failed-but-retryable one is
    // deliberately excluded: its TTL is already spent, and offering a date
    // that has passed reads as a promise the confirm endpoint will break.
    expiresAt:
      status === 'pending'
        ? new Date(row.createdAt.getTime() + proposalTtlMs()).toISOString()
        : null,
    conversationId: row.conversationId,
  };
}
