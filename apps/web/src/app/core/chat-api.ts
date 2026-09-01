import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ChatEvent,
  ChatRequest,
  ConversationDetail,
  ConversationListItem,
  Model,
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
}

export const CHAT_API = new InjectionToken<ChatApi>('CHAT_API');
