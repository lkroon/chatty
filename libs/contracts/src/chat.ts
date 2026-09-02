/** Request body of `POST /api/chat`. */
export interface ChatRequest {
  conversationId?: string;
  model: string;
  content: string;
}

/**
 * SSE event payloads streamed by `POST /api/chat` (`text/event-stream`).
 * `meta` is always the first event, so the client can adopt the
 * conversation id for a brand-new chat before any text arrives.
 */
export type ChatEvent =
  | { type: 'meta'; conversationId: string; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason: string }
  | {
      type: 'error';
      code: 'RATE_LIMIT' | 'UPSTREAM' | 'LIMIT_EXCEEDED';
      message: string;
    };
