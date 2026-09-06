import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ChatEvent,
  ChatRequest,
  ConversationDetail,
  ConversationListItem,
  Model,
  ProposalCard,
} from '@contracts';

/**
 * Port for everything the chat UI needs from the backend. The chat shell
 * provides the concrete implementation at the component level; everything
 * else injects `CHAT_API`.
 */
export interface ChatApi {
  listModels(): Observable<Model[]>;
  listConversations(): Observable<ConversationListItem[]>;
  getConversation(id: string): Observable<ConversationDetail>;
  deleteConversation(id: string): Observable<void>;
  /**
   * Sends a chat turn and streams back `ChatEvent`s in order: one `meta`,
   * zero or more `delta`, then exactly one of `done`/`error`. Unsubscribing
   * before completion aborts the underlying request.
   */
  sendChat(request: ChatRequest): Observable<ChatEvent>;
  /**
   * Confirms a stored proposal.
   *
   * Sends **no body**: the id in the path plus the session cookie are the
   * whole request, and the backend re-reads the row it will execute. Posting
   * the payload from here would defeat the point of the card.
   */
  confirmProposal(id: string): Observable<ProposalCard>;
  /** Discards a stored proposal. Same shape, same reason. */
  discardProposal(id: string): Observable<ProposalCard>;
}

export const CHAT_API = new InjectionToken<ChatApi>('CHAT_API');
