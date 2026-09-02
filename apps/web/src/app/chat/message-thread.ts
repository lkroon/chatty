import { Component, ElementRef, afterRenderEffect, inject, viewChild } from '@angular/core';

import { ChatStore } from '../core/chat-store';
import { MessageBubble } from './message-bubble';
import { ToolChip } from './tool-chip';

@Component({
  selector: 'app-message-thread',
  imports: [MessageBubble, ToolChip],
  template: `
    <div class="thread" #scrollEl>
      @if (store.isLoadingConversation()) {
        <p class="hint">Loading conversation…</p>
      }
      @for (m of store.messages(); track m.id) {
        @if (m.toolCalls?.length) {
          <div class="tool-chips">
            @for (chip of m.toolCalls; track chip.callId) {
              <app-tool-chip [chip]="chip" />
            }
          </div>
        }
        <app-message-bubble [message]="m" />
      }
      @if (store.isStreaming()) {
        @if (store.streamingToolCalls().length) {
          <div class="tool-chips">
            @for (chip of store.streamingToolCalls(); track chip.callId) {
              <app-tool-chip [chip]="chip" />
            }
          </div>
        }
        @if (store.streamingThinking() && !store.streamingText()) {
          <p class="hint hint--thinking">Thinking…</p>
        }
        @if (store.streamingText()) {
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
    // The .thread div's own flex:1/overflow-y:auto only constrain
    // anything if this host element is itself sized within chat-shell's
    // flex column — otherwise .thread grows to fit all messages and the
    // whole page scrolls past chat-shell's fixed-height dark background
    // onto <body>'s (see chat-shell.scss's .main min-height: 0 comment).
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

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

    .hint--thinking {
      align-self: flex-start;
      margin: 0;
      text-align: left;
    }

    .tool-chips {
      align-self: flex-start;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      max-width: min(48rem, 85%);
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
