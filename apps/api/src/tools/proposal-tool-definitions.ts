import type { ToolDefinition } from './tool-runtime';

/**
 * The three write tools, offered only when GOOGLE_WRITE_TOOLS_ENABLED=true.
 *
 * Every description states the same thing in the model's own terms: calling
 * this does not perform the action. That wording is load-bearing — a model
 * that believes it just created an event will tell the user so, above a card
 * they have not touched.
 *
 * Times are local wall-clock with no offset. The server attaches the zone, so
 * the model cannot get DST wrong.
 */
export const PROPOSAL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description:
        'Propose a calendar event. This does NOT create anything: it shows the user a card they must confirm. Use it whenever the user asks to schedule, book or add something to their calendar. After calling it, say what you proposed and that it is awaiting their confirmation.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short event title, e.g. "Dentist".' },
          start: {
            type: 'string',
            description:
              'Local start time, "YYYY-MM-DDTHH:MM:SS". No timezone offset and no "Z".',
          },
          end: {
            type: 'string',
            description:
              'Local end time in the same format. Omit for a 30-minute event.',
          },
          location: { type: 'string', description: 'Optional location.' },
          description: { type: 'string', description: 'Optional notes for the event.' },
        },
        required: ['title', 'start'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        'Propose a task on the user\'s default Google Tasks list. This does NOT create anything: it shows the user a card they must confirm. After calling it, say what you proposed and that it is awaiting their confirmation.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What needs doing.' },
          due: { type: 'string', description: 'Optional due date, "YYYY-MM-DD".' },
          notes: { type: 'string', description: 'Optional notes.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description:
        'Propose an email from the user\'s own Gmail account. This does NOT send anything: it shows the user a card they must confirm, and only they can send it. Write the full message body — the user reads it on the card before confirming.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'array',
            items: { type: 'string' },
            description: 'Recipient email addresses, at most 5.',
          },
          subject: { type: 'string', description: 'Subject line.' },
          body: { type: 'string', description: 'Plain-text message body.' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
];

/** Human noun per write tool, for chip labels. */
export const PROPOSAL_TOOL_LABELS: Readonly<Record<string, string>> = {
  create_calendar_event: 'calendar event',
  create_task: 'task',
  send_email: 'email',
};
