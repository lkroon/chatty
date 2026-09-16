import { Component, ElementRef, afterRenderEffect, inject, viewChild } from '@angular/core';

import { ChatStore } from '../core/chat-store';
import { ViewportFit } from '../core/viewport-fit';
import { MessageBubble } from './message-bubble';
import { ProposalCard } from './proposal-card';
import { ToolChip } from './tool-chip';

@Component({
  selector: 'app-message-thread',
  imports: [MessageBubble, ToolChip, ProposalCard],
  template: `
    <div class="thread" #scrollEl>
      @if (store.isLoadingConversation()) {
        <p class="hint">Loading conversation…</p>
      }
      @for (m of store.messages(); track m.id) {
        @if (m.toolCalls?.length) {
          <div class="tool-chips">
            @for (chip of m.toolCalls; track chip.callId) {
              @if (chip.proposal; as proposal) {
                <app-proposal-card
                  [card]="proposal"
                  [busy]="store.isProposalBusy(proposal.id)"
                  (confirmed)="store.confirmProposal(proposal.id)"
                  (discarded)="store.discardProposal(proposal.id)"
                />
              } @else {
                <app-tool-chip [chip]="chip" />
              }
            }
          </div>
        }
        <app-message-bubble [message]="m" />
      }
      @if (store.isStreaming()) {
        @if (store.streamingToolCalls().length) {
          <div class="tool-chips">
            @for (chip of store.streamingToolCalls(); track chip.callId) {
              @if (chip.proposal; as proposal) {
                <app-proposal-card
                  [card]="proposal"
                  [busy]="store.isProposalBusy(proposal.id)"
                  (confirmed)="store.confirmProposal(proposal.id)"
                  (discarded)="store.discardProposal(proposal.id)"
                />
              } @else {
                <app-tool-chip [chip]="chip" />
              }
            }
          </div>
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
        @if (store.activityLabel(); as label) {
          <p class="activity" role="status" [attr.aria-label]="label">
            <span class="activity__dots" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <span class="activity__label">{{ label }}</span>
          </p>
        }
      }
      @if (
        !store.isStreaming() && !store.isLoadingConversation() && store.messages().length === 0
      ) {
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

    .activity {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 0.45em;
      margin: 0;
      opacity: 0.6;
      font-size: 0.85em;
    }

    .activity__dots {
      display: inline-flex;
      gap: 0.22em;
    }

    .activity__dots span {
      width: 0.34em;
      height: 0.34em;
      border-radius: 50%;
      background: currentColor;
      animation: activity-pulse 1.2s ease-in-out infinite;
    }

    .activity__dots span:nth-child(2) {
      animation-delay: 0.15s;
    }

    .activity__dots span:nth-child(3) {
      animation-delay: 0.3s;
    }

    @keyframes activity-pulse {
      0%,
      70%,
      100% {
        opacity: 0.25;
      }
      35% {
        opacity: 1;
      }
    }

    // Motion is the whole point of this indicator, so when it is not
    // available the dots stay fully lit rather than vanishing — the label
    // beside them still says what is happening.
    @media (prefers-reduced-motion: reduce) {
      .activity__dots span {
        animation: none;
        opacity: 0.7;
      }
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
  private readonly viewportFit = inject(ViewportFit);
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
      // The indicator and the tool chips change the thread's height on
      // their own schedule, between deltas — without reading them here the
      // thread stops re-pinning for exactly the stretch where nothing else
      // is arriving to re-pin it.
      this.store.streamingToolCalls();
      this.store.activityLabel();
      // The keyboard opening shortens the thread; without re-pinning, the
      // last message slides up out of view exactly when the user is about
      // to reply to it.
      this.viewportFit.height();
      const el = this.scrollEl().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }
}
