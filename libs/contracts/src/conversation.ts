/**
 * A single message within a conversation, as returned by
 * `GET /api/conversations/:id`.
 *
 * Design note (Wave 0): the plan freezes the `messages` DB table's
 * nullable `finish_reason` column and the overall response shape
 * (`{ id, title, messages: Message[] }`) but does not spell out every
 * field of `Message` itself. `id`, `role`, `content`, `createdAt` and
 * `finishReason` are the minimal fields needed to render a chat transcript
 * and to surface the frozen `finish_reason` semantics ('aborted' on
 * client disconnect mid-stream, null when complete). Timestamps are
 * ISO-8601 strings over the wire (JSON has no Date type). If workstream C
 * needs additional fields, extend this interface rather than working
 * around it.
 */
import type { ToolCallChip } from './chat';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  finishReason: string | null;
  /**
   * Wave 1.5: the tool calls the assistant made while producing this
   * message, in `ordinal` order. Absent (not an empty array) for a
   * message with no tool calls, and never present on a `user` message.
   */
  toolCalls?: ToolCallChip[];
}

/** One row of `GET /api/conversations`. */
export interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: string;
}

/** Response body of `GET /api/conversations/:id`. */
export interface ConversationDetail {
  id: string;
  title: string;
  messages: Message[];
}
