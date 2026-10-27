import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import type {
  ChatEvent,
  ConversationListItem,
  Message,
  Model,
  ProposalCard,
  SearchHit,
  ToolCallChip,
} from '@contracts';

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
  /** Keyset cursor for the next page of the conversation list; null when exhausted. */
  readonly conversationsCursor = signal<string | null>(null);
  /** True while the next page is in flight; load-more double-fire guard. */
  readonly isLoadingMore = signal(false);
  readonly hasMoreConversations = computed(
    () => this.conversationsCursor() !== null,
  );
  readonly activeConversationId = signal<string | null>(null);
  readonly isLoadingConversation = signal(false);

  /** Raw text of the search input; drives everything below. */
  readonly searchQuery = signal('');
  /** Hits for the last fired search; empty when idle. */
  readonly searchHits = signal<SearchHit[]>([]);
  readonly isSearching = signal(false);
  /** True while a non-empty query is in the box — the sidebar swaps lists on it. */
  readonly isSearchActive = computed(() => this.searchQuery().trim() !== '');

  readonly messages = signal<Message[]>([]);
  readonly streamingText = signal('');
  readonly isStreaming = signal(false);
  /** Chips for the tool calls made so far this exchange, in call order. */
  readonly streamingToolCalls = signal<ToolCallChip[]>([]);
  /** True while the model's reasoning is streaming and no visible text has arrived yet. */
  readonly streamingThinking = signal(false);

  readonly error = signal<string | null>(null);

  /** Proposal ids with a confirm/discard in flight, so a card can't be double-tapped. */
  private readonly proposalBusy = signal<ReadonlySet<string>>(new Set());

  /**
   * Proposals in this conversation still waiting on a decision. Derived from
   * the messages already loaded — no fetch, because chat only ever shows one
   * conversation and this count is about the cards on this screen. Today is
   * what counts them across all conversations.
   */
  readonly pendingProposalCount = computed(() => {
    const chips = [
      ...this.messages().flatMap((msg) => msg.toolCalls ?? []),
      ...this.streamingToolCalls(),
    ];
    return chips.filter((chip) => chip.proposal?.confirmable).length;
  });

  /**
   * The line shown under the thread while a response is in flight, or null
   * when there is nothing to say.
   *
   * There used to be no indicator at all for most of an exchange: the only
   * one was "Thinking…", gated on a `thinking` event having arrived with no
   * text yet, and the first delta cleared it for good. That left three
   * stretches where the screen was simply still — before the first event,
   * between tool rounds once text had already streamed, and for any model
   * whose upstream sends no reasoning frames at all. From the outside those
   * are indistinguishable from a hung request.
   *
   * A running tool chip carries its own spinner and its own label
   * ("Searching…", "Reading…"), so this yields to it rather than stacking a
   * second indicator underneath.
   */
  readonly activityLabel = computed<string | null>(() => {
    if (!this.isStreaming()) {
      return null;
    }
    if (this.streamingToolCalls().some((chip) => chip.status === 'running')) {
      return null;
    }
    return this.streamingThinking() ? 'Thinking…' : 'Working…';
  });

  private pendingMessageId: string | null = null;
  private streamSub?: Subscription;

  /** Debounce timer for the sidebar search (B4). */
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Monotonic id of the last fired search — stale responses are dropped. */
  private searchSequence = 0;

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
    // Page-1 reset: replaces the list rather than appending. `done` calls
    // this to refresh ordering, so a user who scrolled deep is snapped back
    // to the first page — accepted for v1.
    this.api.listConversationPage().subscribe({
      next: (page) => {
        this.conversations.set(page.items);
        this.conversationsCursor.set(page.nextCursor);
      },
      error: () => this.error.set('Failed to load conversations.'),
    });
  }

  /** Appends the next page via the stored cursor (A4). */
  loadMoreConversations(): void {
    const cursor = this.conversationsCursor();
    if (this.isLoadingMore() || cursor === null) {
      return;
    }
    this.isLoadingMore.set(true);
    this.api.listConversationPage(cursor).subscribe({
      next: (page) => {
        // A page-1 refresh can race an in-flight load-more and push the
        // same row into both lists; @for track would throw on duplicate
        // ids, so appends filter what's already shown.
        this.conversations.update((list) => {
          const seen = new Set(list.map((c) => c.id));
          return [...list, ...page.items.filter((c) => !seen.has(c.id))];
        });
        this.conversationsCursor.set(page.nextCursor);
        this.isLoadingMore.set(false);
      },
      error: () => {
        this.isLoadingMore.set(false);
        this.error.set('Failed to load more conversations.');
      },
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

  /**
   * The sidebar search input, debounced ~300ms: typing resets the timer,
   * a quiet stretch fires the query. An emptied box returns to the
   * conversation list immediately — no request, hits cleared.
   */
  onSearchInput(query: string): void {
    this.searchQuery.set(query);
    if (this.searchTimer !== undefined) {
      clearTimeout(this.searchTimer);
    }
    const trimmed = query.trim();
    if (!trimmed) {
      this.searchHits.set([]);
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this.searchTimer = setTimeout(() => this.runSearch(trimmed), 300);
  }

  /** Clears the search and returns to the conversation list. */
  clearSearch(): void {
    if (this.searchTimer !== undefined) {
      clearTimeout(this.searchTimer);
    }
    this.searchQuery.set('');
    this.searchHits.set([]);
    this.isSearching.set(false);
  }

  private runSearch(query: string): void {
    const sequence = ++this.searchSequence;
    this.api.search(query).subscribe({
      next: (hits) => {
        // The query may have changed (or been cleared) while this was in
        // flight — only the newest search may write its results.
        if (sequence !== this.searchSequence || !this.isSearchActive()) {
          return;
        }
        this.searchHits.set(hits);
        this.isSearching.set(false);
      },
      error: () => {
        if (sequence !== this.searchSequence || !this.isSearchActive()) {
          return;
        }
        this.isSearching.set(false);
        this.error.set('Search failed. Please try again.');
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
    if (!trimmed || this.isStreaming() || !this.selectedModelId()) {
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
        error: () => this.failStream(),
        complete: () => {
          if (this.isStreaming()) {
            this.failStream();
          }
        },
      });
  }

  private failStream(): void {
    this.isStreaming.set(false);
    this.streamingText.set('');
    this.streamingToolCalls.set([]);
    this.streamingThinking.set(false);
    this.error.set('Something went wrong sending that message. Please try again.');
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

  isProposalBusy(id: string): boolean {
    return this.proposalBusy().has(id);
  }

  confirmProposal(id: string): void {
    this.runProposalAction(id, this.api.confirmProposal(id));
  }

  discardProposal(id: string): void {
    this.runProposalAction(id, this.api.discardProposal(id));
  }

  /**
   * The server returns the whole updated card, and it is written straight
   * back over the old one — the client never guesses what the new status is.
   */
  private runProposalAction(id: string, action: Observable<ProposalCard>): void {
    if (this.isProposalBusy(id)) {
      return;
    }
    this.setProposalBusy(id, true);
    this.error.set(null);
    action.subscribe({
      next: (card) => {
        this.setProposalBusy(id, false);
        this.applyProposal(card);
      },
      error: (err: unknown) => {
        this.setProposalBusy(id, false);
        // The API port already unwrapped the server's message for these two
        // calls — "reconnect Google" is the whole point of the 409.
        this.error.set((err as Error)?.message ?? 'That could not be completed. Please try again.');
      },
    });
  }

  private setProposalBusy(id: string, busy: boolean): void {
    this.proposalBusy.update((ids) => {
      const next = new Set(ids);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private applyProposal(card: ProposalCard): void {
    const replace = (chips: ToolCallChip[]): ToolCallChip[] =>
      chips.map((chip) => (chip.proposal?.id === card.id ? { ...chip, proposal: card } : chip));

    this.messages.update((msgs) =>
      msgs.map((msg) =>
        msg.toolCalls?.some((chip) => chip.proposal?.id === card.id)
          ? { ...msg, toolCalls: replace(msg.toolCalls) }
          : msg,
      ),
    );
    this.streamingToolCalls.update(replace);
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
