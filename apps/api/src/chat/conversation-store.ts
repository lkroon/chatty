/**
 * A<->C seam (Wave 1 stand-in): the plan has workstream A persist the
 * user message via C's real Postgres-backed store and call C's
 * UsageService.consume(). Since C's real persistence code doesn't exist
 * yet while both workstreams build in parallel with no shared files,
 * workstream A defines this narrow interface here and builds against an
 * in-memory fake that satisfies it — the same pattern the plan already
 * uses for workstream D against a mock, swapped for the real backend
 * later.
 */
export interface ConversationHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationStore {
  /**
   * Called once per POST /api/chat, right after usage.consume() succeeds
   * and before opening the upstream stream. If conversationId is
   * omitted, creates a new conversation (title = first 60 chars of
   * userContent). Always persists the user message, and creates an
   * empty assistant message placeholder row (content: '', finishReason:
   * null) whose id becomes the `meta` SSE event's messageId.
   */
  startExchange(input: {
    accountId: string;
    conversationId?: string;
    model: string;
    userContent: string;
  }): Promise<{ conversationId: string; assistantMessageId: string }>;

  /**
   * Returns the stored conversation history, excluding the assistant
   * placeholder created by the matching startExchange call.
   */
  getHistory(input: {
    accountId: string;
    conversationId: string;
    excludeMessageId: string;
  }): Promise<ConversationHistoryMessage[]>;

  /**
   * Called once when the stream ends, whether normally or via client
   * abort. content = full accumulated assistant text streamed so far
   * (empty string if none). aborted = true => finish_reason = 'aborted'
   * in the DB; false => finish_reason = NULL.
   */
  finalizeAssistantMessage(input: {
    assistantMessageId: string;
    content: string;
    aborted: boolean;
  }): Promise<void>;
}

// Wave 2 integration point: bind this token to workstream C's real
// Postgres-backed implementation (apps/api/src/conversations/**), which
// must satisfy this interface exactly.
export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');
