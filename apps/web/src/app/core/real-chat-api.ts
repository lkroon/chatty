import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, from } from 'rxjs';
import type {
  ChatEvent,
  ChatRequest,
  ConversationDetail,
  ConversationListItem,
  Model,
} from '@contracts';

import { ChatApi } from './chat-api';
import { SseFrameParser } from './sse-frame-parser';

/**
 * `ChatApi` backed by the real `/api/*` endpoints.
 *
 * GET/DELETE calls plus the streaming POST all go through `fetch()` rather
 * than `HttpClient` so this class has no dependency on `provideHttpClient`
 * being registered anywhere (it isn't, today — that's workstream E's call to
 * make in `app.config.ts`, which this workstream doesn't own).
 */
@Injectable()
export class RealChatApi implements ChatApi {
  private readonly router = inject(Router);

  listModels(): Observable<Model[]> {
    return from(this.getJson<Model[]>('/api/models'));
  }

  listConversations(): Observable<ConversationListItem[]> {
    return from(this.getJson<ConversationListItem[]>('/api/conversations'));
  }

  getConversation(id: string): Observable<ConversationDetail> {
    return from(this.getJson<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`));
  }

  deleteConversation(id: string): Observable<void> {
    return from(
      this.request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
        () => undefined,
      ),
    );
  }

  sendChat(request: ChatRequest): Observable<ChatEvent> {
    return new Observable<ChatEvent>((subscriber) => {
      const controller = new AbortController();

      (async () => {
        let response: Response;
        try {
          response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal,
          });
        } catch (err) {
          if (!isAbortError(err)) {
            subscriber.error(err);
          } else {
            subscriber.complete();
          }
          return;
        }

        if (this.redirectIfUnauthenticated(response)) {
          subscriber.complete();
          return;
        }
        if (!response.ok || !response.body) {
          subscriber.error(new Error(`chat request failed (${response.status})`));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseFrameParser();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            const frames = parser.push(decoder.decode(value, { stream: true }));
            for (const frame of frames) {
              const event = JSON.parse(frame.data) as ChatEvent;
              subscriber.next(event);
              if (event.type === 'done' || event.type === 'error') {
                subscriber.complete();
                return;
              }
            }
          }
          subscriber.complete();
        } catch (err) {
          if (!isAbortError(err)) {
            subscriber.error(err);
          } else {
            subscriber.complete();
          }
        }
      })();

      return () => controller.abort();
    });
  }

  /** Returns true (and navigates) when the response is a 401/403. */
  private redirectIfUnauthenticated(response: Response): boolean {
    if (response.status === 401 || response.status === 403) {
      void this.router.navigateByUrl('/login');
      return true;
    }
    return false;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(path, init);
    if (this.redirectIfUnauthenticated(response)) {
      throw new Error(`authentication required (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`request to ${path} failed (${response.status})`);
    }
    return response;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return (await response.json()) as T;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
