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
    // whole page scrolls past chat-shell's fixed-height background
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
      gap: 0.55rem;
      padding: 0.7rem;
      box-sizing: border-box;
    }

    .hint {
      color: var(--oc-text-muted);
      text-align: center;
      margin: auto;
    }

    .hint--thinking {
      align-self: flex-start;
      margin: 0;
      text-align: left;
      font-family: var(--font-meta);
      font-size: 0.8rem;
    }

    .tool-chips {
      align-self: flex-start;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      max-width: 100%;
    }

    .error {
      align-self: center;
      color: var(--oc-error);
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
