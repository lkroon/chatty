import { createCalendarEvent } from './calendar-writer';
import { sendEmail } from './gmail-writer';
import type {
  CalendarEventPayload,
  EmailPayload,
  TaskPayload,
  WriteResult,
} from './proposal-payloads';
import type { ProposalRow } from './proposal-row';
import { createTask } from './tasks-writer';

/**
 * Dispatches one claimed row to the writer for its kind.
 *
 * Takes the whole row, not a payload, because the calendar writer needs the
 * row's id as its idempotency key — passing the payload alone would silently
 * lose exactly-once.
 */
export async function executeProposal(
  row: ProposalRow,
  accessToken: string,
  timeZone: string,
): Promise<WriteResult> {
  switch (row.kind) {
    case 'calendar_event':
      return createCalendarEvent(
        accessToken,
        row.payload as CalendarEventPayload,
        row.id,
        timeZone,
      );
    case 'task':
      return createTask(accessToken, row.payload as TaskPayload);
    case 'email':
      return sendEmail(accessToken, row.payload as EmailPayload);
    default:
      throw new Error(`Cannot execute proposal of unknown kind: ${String(row.kind)}`);
  }
}
