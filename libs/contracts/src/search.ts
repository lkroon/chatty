/**
 * One result of `GET /api/search?q=` — a message that matched the query
 * semantically, in descending score order.
 */
export interface SearchHit {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: 'user' | 'assistant';
  /** First 200 chars of the matched message's content. */
  snippet: string;
  /** 1 - cosine distance to the query embedding; higher is closer. */
  score: number;
  createdAt: string;
}
