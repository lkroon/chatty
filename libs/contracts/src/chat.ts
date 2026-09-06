import type { ProposalCard } from './proposal';

/** Request body of `POST /api/chat`. */
export interface ChatRequest {
  conversationId?: string;
  model: string;
  content: string;
}

/**
 * Model-driven tools. The first two read; the last three only ever write a
 * `proposals` row that the user must confirm — see
 * apps/api/src/tools/proposal-tool-definitions.ts.
 */
export type ToolName =
  | 'web_search'
  | 'web_fetch'
  | 'create_calendar_event'
  | 'create_task'
  | 'send_email';

/** A source the assistant actually consulted. Rendered as a link. */
export interface ToolSource {
  title: string;
  url: string;
}

/** One tool invocation, as shown in the transcript. Never carries page text. */
export interface ToolCallChip {
  callId: string;
  name: ToolName;
  status: 'running' | 'done' | 'failed';
  /** Human line, e.g. `Searched "hacker news top story"` or `Read nginx.org`. */
  label: string;
  sources: ToolSource[];
  /**
   * Present only for the three write tools, and only when the proposal was
   * actually persisted. Always re-read from the `proposals` row when a
   * conversation is loaded, so a stale "Confirm" never appears on an event
   * that was already created.
   */
  proposal?: ProposalCard;
}

/**
 * SSE event payloads streamed by `POST /api/chat` (`text/event-stream`).
 * `meta` is always the first event, so the client can adopt the
 * conversation id for a brand-new chat before any text arrives.
 *
 * `thinking` is emitted at most once per upstream round, on the first
 * frame carrying the model's chain-of-thought (`delta.reasoning_content`
 * upstream). It carries no text — the reasoning itself is never sent to
 * the browser.
 *
 * `tool` is emitted twice per call: once with `status: 'running'` when
 * execution starts, once with `status: 'done' | 'failed'` when it ends.
 * Both carry the same `callId` (the upstream's `tool_calls[].id`); the
 * web client keys on `callId` and replaces in place.
 */
export type ChatEvent =
  | { type: 'meta'; conversationId: string; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'thinking' }
  | { type: 'tool'; chip: ToolCallChip }
  | { type: 'done'; finishReason: string }
  | {
      type: 'error';
      code: 'RATE_LIMIT' | 'UPSTREAM' | 'LIMIT_EXCEEDED';
      message: string;
    };
