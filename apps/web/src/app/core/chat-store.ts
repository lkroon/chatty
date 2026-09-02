import { Injectable, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import type { ChatEvent, ConversationListItem, Message, Model } from '@contracts';

import { CHAT_API } from './chat-api';

const MODEL_STORAGE_KEY = 'oc-model';

/**
 * Signal-based store for the chat feature: conversation list, active
 * conversation's messages, and the in-flight streaming buffer. Provided at
 * the `ChatShell` component level (not `providedIn: 'root'`) so it shares
 * that element injector with the `CHAT_API` token — a root-provided service
 * would be constructed against the root injector and couldn't see a
 * component-level provider. See `chat/chat-shell.ts`.
 */
@Injectable()
export class ChatStore {
  private readonly api = inject(CHAT_API);

  readonly models = signal<Model[]>([]);
  readonly selectedModelId = signal<string>('');

  readonly conversations = signal<ConversationListItem[]>([]);
  readonly activeConversationId = signal<string | null>(null);
  readonly isLoadingConversation = signal(false);

  readonly messages = signal<Message[]>([]);
  readonly streamingText = signal('');
  readonly isStreaming = signal(false);

  readonly error = signal<string | null>(null);

  private pendingMessageId: string | null = null;
  private streamSub?: Subscription;

  constructor() {
    this.loadModels();
    this.loadConversations();
  }

  loadModels(): void {
    this.api.listModels().subscribe({
      next: (models) => {
        this.models.set(models);
        const stored = readLocalStorage(MODEL_STORAGE_KEY);
        const next = stored && models.some((m) => m.id === stored) ? stored : (models[0]?.id ?? '');
        this.selectedModelId.set(next);
        if (next) {
          writeLocalStorage(MODEL_STORAGE_KEY, next);
        }
      },
      error: () => this.error.set('Failed to load models.'),
    });
  }

  selectModel(id: string): void {
    this.selectedModelId.set(id);
    writeLocalStorage(MODEL_STORAGE_KEY, id);
  }

  loadConversations(): void {
    this.api.listConversations().subscribe({
      next: (list) => this.conversations.set(list),
      error: () => this.error.set('Failed to load conversations.'),
    });
  }

  selectConversation(id: string): void {
    if (id === this.activeConversationId() && !this.isStreaming()) {
      return;
    }
    this.cancelStreaming();
    this.activeConversationId.set(id);
    this.isLoadingConversation.set(true);
    this.error.set(null);
    this.api.getConversation(id).subscribe({
      next: (detail) => {
        this.messages.set(detail.messages);
        this.isLoadingConversation.set(false);
      },
      error: () => {
        this.isLoadingConversation.set(false);
        this.error.set('Failed to load that conversation.');
      },
    });
  }

  newConversation(): void {
    this.cancelStreaming();
    this.activeConversationId.set(null);
    this.messages.set([]);
    this.streamingText.set('');
    this.error.set(null);
  }

  deleteConversation(id: string): void {
    this.api.deleteConversation(id).subscribe({
      next: () => {
        this.conversations.update((list) => list.filter((c) => c.id !== id));
        if (this.activeConversationId() === id) {
          this.newConversation();
        }
      },
      error: () => this.error.set('Failed to delete that conversation.'),
    });
  }

  send(content: string): void {
    const trimmed = content.trim();
    if (!trimmed || this.isStreaming()) {
      return;
    }
    this.error.set(null);

    const userMessage: Message = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
      finishReason: null,
    };
    this.messages.update((msgs) => [...msgs, userMessage]);
    this.streamingText.set('');
    this.isStreaming.set(true);
    this.pendingMessageId = null;

    this.streamSub = this.api
      .sendChat({
        conversationId: this.activeConversationId() ?? undefined,
        model: this.selectedModelId(),
        content: trimmed,
      })
      .subscribe({
        next: (event) => this.handleEvent(event),
        error: () => {
          this.isStreaming.set(false);
          this.streamingText.set('');
          this.error.set('Something went wrong sending that message. Please try again.');
        },
      });
  }

  /** Aborts the in-flight response, if any, and resets streaming state. */
  cancelStreaming(): void {
    if (!this.isStreaming()) {
      return;
    }
    this.streamSub?.unsubscribe();
    this.isStreaming.set(false);
    this.streamingText.set('');
  }

  private handleEvent(event: ChatEvent): void {
    switch (event.type) {
      case 'meta': {
        const isNewConversation = this.activeConversationId() === null;
        this.activeConversationId.set(event.conversationId);
        this.pendingMessageId = event.messageId;
        if (isNewConversation) {
          this.loadConversations();
        }
        break;
      }
      case 'delta':
        this.streamingText.update((text) => text + event.text);
        break;
      case 'done': {
        const assistantMessage: Message = {
          id: this.pendingMessageId ?? `local-${Date.now()}`,
          role: 'assistant',
          content: this.streamingText(),
          createdAt: new Date().toISOString(),
          finishReason: event.finishReason,
        };
        this.messages.update((msgs) => [...msgs, assistantMessage]);
        this.streamingText.set('');
        this.isStreaming.set(false);
        this.loadConversations();
        break;
      }
      case 'error':
        this.isStreaming.set(false);
        this.streamingText.set('');
        this.error.set(event.message);
        break;
    }
  }
}

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, disabled, etc.) — non-fatal.
  }
}
