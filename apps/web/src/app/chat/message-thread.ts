import { Component, ElementRef, afterRenderEffect, inject, viewChild } from '@angular/core';

import { ChatStore } from '../core/chat-store';
import { MessageBubble } from './message-bubble';

@Component({
  selector: 'app-message-thread',
  imports: [MessageBubble],
  template: `
    <div class="thread" #scrollEl>
      @if (store.isLoadingConversation()) {
        <p class="hint">Loading conversation…</p>
      }
      @for (m of store.messages(); track m.id) {
        <app-message-bubble [message]="m" />
      }
      @if (store.isStreaming()) {
        <app-message-bubble
          [message]="{
            id: 'streaming',
            role: 'assistant',
            content: store.streamingText(),
            createdAt: '',
            finishReason: null,
          }"
        />
      }
      @if (!store.isStreaming() && !store.isLoadingConversation() && store.messages().length === 0) {
        <p class="hint">Say something to start the conversation.</p>
      }
      @if (store.error()) {
        <p class="error">{{ store.error() }}</p>
      }
    </div>
  `,
  styles: `
    .thread {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      padding: 1rem;
      box-sizing: border-box;
    }

    .hint {
      opacity: 0.6;
      text-align: center;
      margin: auto;
    }

    .error {
      align-self: center;
      color: var(--oc-error, #ff6b6b);
      font-size: 0.9em;
    }
  `,
})
export class MessageThread {
  protected readonly store = inject(ChatStore);
  private readonly scrollEl = viewChild.required<ElementRef<HTMLDivElement>>('scrollEl');

  constructor() {
    // Re-runs whenever messages()/streamingText()/isStreaming() change and a
    // render has happened, keeping the thread pinned to the latest content
    // as SSE deltas stream in.
    afterRenderEffect(() => {
      // Read the signals so this effect is scheduled after they change.
      this.store.messages();
      this.store.streamingText();
      this.store.isStreaming();
      const el = this.scrollEl().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }
}
