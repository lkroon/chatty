import { Injectable, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import type { ChatEvent, ConversationListItem, Message, Model, ToolCallChip } from '@contracts';

import { CHAT_API } from './chat-api';

/**
 * Holds an *explicit* model choice only — nothing else ever writes it.
 *
 * The key is deliberately not the old `oc-model`. That one was written on
 * every load with whatever model had been resolved, default included, so a
 * browser that had ever opened the app carried an id indistinguishable from
 * a deliberate pick, and it beat the preferred default forever. There is no
 * way to tell those two apart after the fact, so the old key is abandoned
 * (and cleared): everyone falls back to the default once, and from then on
 * only a real choice is stored.
 */
const MODEL_STORAGE_KEY = 'chatty-model-choice';
const LEGACY_MODEL_STORAGE_KEY = 'oc-model';

/**
 * What a first-time visitor gets, before they have ever picked a model.
 * Without it the default was models[0] — whatever the upstream /models call
 * happened to list first, which is nobody's decision and changes when the
 * provider reorders its catalogue.
 *
 * Only a preference: if the id is not in the live list it falls through to
 * the first available model, so a retired id degrades instead of breaking.
 * Once the user picks anything, their stored choice wins for good.
 */
const PREFERRED_DEFAULT_MODEL_ID = 'glm-5.3-flash';

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
  /** Chips for the tool calls made so far this exchange, in call order. */
  readonly streamingToolCalls = signal<ToolCallChip[]>([]);
  /** True while the model's reasoning is streaming and no visible text has arrived yet. */
  readonly streamingThinking = signal(false);

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
        removeLocalStorage(LEGACY_MODEL_STORAGE_KEY);
        const chosen = readLocalStorage(MODEL_STORAGE_KEY);
        const has = (id: string | null) => !!id && models.some((m) => m.id === id);
        // Nothing is written back here: resolving a default is not a choice,
        // and storing it would turn it into one on the next load.
        this.selectedModelId.set(
          has(chosen)
            ? chosen!
            : has(PREFERRED_DEFAULT_MODEL_ID)
              ? PREFERRED_DEFAULT_MODEL_ID
              : (models[0]?.id ?? ''),
        );
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
    this.streamingToolCalls.set([]);
    this.streamingThinking.set(false);
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
    this.streamingToolCalls.set([]);
    this.streamingThinking.set(false);
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
        this.streamingThinking.set(false);
        break;
      case 'thinking':
        this.streamingThinking.set(true);
        break;
      case 'tool':
        this.streamingToolCalls.update((chips) => {
          const index = chips.findIndex((c) => c.callId === event.chip.callId);
          if (index === -1) {
            return [...chips, event.chip];
          }
          const next = [...chips];
          next[index] = event.chip;
          return next;
        });
        break;
      case 'done': {
        const toolCalls = this.streamingToolCalls();
        const assistantMessage: Message = {
          id: this.pendingMessageId ?? `local-${Date.now()}`,
          role: 'assistant',
          content: this.streamingText(),
          createdAt: new Date().toISOString(),
          finishReason: event.finishReason,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        this.messages.update((msgs) => [...msgs, assistantMessage]);
        this.streamingText.set('');
        this.streamingToolCalls.set([]);
        this.streamingThinking.set(false);
        this.isStreaming.set(false);
        this.loadConversations();
        break;
      }
      case 'error':
        this.isStreaming.set(false);
        this.streamingText.set('');
        this.streamingToolCalls.set([]);
        this.streamingThinking.set(false);
        this.error.set(event.message);
        break;
      default:
        // Unknown future event type — ignored, not thrown on.
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

function removeLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode, disabled, etc.) — non-fatal.
  }
}
