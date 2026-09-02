import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import type { Message } from '@contracts';

import { renderMarkdownToHtml } from '../core/markdown';

@Component({
  selector: 'app-message-bubble',
  imports: [],
  template: `
    <div
      class="msg-bubble"
      [class.msg-bubble--user]="message().role === 'user'"
      [class.msg-bubble--assistant]="message().role === 'assistant'"
    >
      @if (message().role === 'assistant') {
        <div class="markdown-body" [innerHTML]="renderedHtml()" (click)="onContentClick($event)"></div>
      } @else {
        <div class="msg-bubble__plain">{{ message().content }}</div>
      }
      @if (message().finishReason === 'aborted') {
        <p class="msg-bubble__note">Stopped before finishing.</p>
      }
    </div>
  `,
  // ViewEncapsulation.None: assistant content is rendered via [innerHTML]
  // (marked + DOMPurify output), which Angular never stamps with its
  // emulated-encapsulation content attribute — scoped selectors would
  // silently fail to match it. Class names below are namespaced
  // (`msg-bubble__*`, `markdown-body`) to avoid leaking into the rest of
  // the app now that these rules are global.
  encapsulation: ViewEncapsulation.None,
  styles: `
    .msg-bubble {
      max-width: min(30rem, 85%);
      padding: 0.65rem 0.9rem;
      line-height: 1.5;
      word-wrap: break-word;
      font-size: 0.92rem;
    }

    /* margin auto, not align-self: app-message-bubble (this component's
       host tag) is the actual flex item in app-message-thread's column
       layout, not this inner div — align-self on the div would be a no-op.
       Margin auto floats the (already max-width-capped) bubble to the
       correct edge regardless of what kind of box its host turns out to be. */
    .msg-bubble--user {
      margin-left: auto;
      background: var(--oc-user-bubble, #ff6f59);
      color: #fff;
      border-radius: 18px 18px 4px 18px;
    }

    .msg-bubble--assistant {
      margin-right: auto;
      background: var(--oc-assistant-bubble, #fff);
      border: 1px solid var(--oc-border, #dcece4);
      border-radius: 18px 18px 18px 4px;
    }

    .msg-bubble__plain {
      white-space: pre-wrap;
    }

    .msg-bubble__note {
      margin: 0.4em 0 0;
      font-size: 0.8em;
      opacity: 0.7;
    }

    .msg-bubble .markdown-body p {
      margin: 0.4em 0;
    }

    .msg-bubble .markdown-body p:first-child {
      margin-top: 0;
    }

    .msg-bubble .markdown-body p:last-child {
      margin-bottom: 0;
    }

    .msg-bubble .markdown-body pre {
      overflow-x: auto;
      padding: 0.75em;
      border-radius: 12px;
      background: #22252b;
      color: #e7e7e5;
    }

    .msg-bubble .markdown-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85em;
    }

    .msg-bubble--assistant .markdown-body :not(pre) > code {
      background: var(--oc-bg, #eef6f2);
      padding: 0.15em 0.4em;
      border-radius: 4px;
    }

    .msg-bubble .markdown-body .code-block {
      position: relative;
      margin: 0.5em 0;
    }

    .msg-bubble .markdown-body .copy-btn {
      position: absolute;
      top: 0.4em;
      right: 0.4em;
      font-size: 0.75em;
      padding: 0.25em 0.6em;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.08);
      color: inherit;
      cursor: pointer;
    }

    .msg-bubble .markdown-body .copy-btn:hover {
      background: rgba(255, 255, 255, 0.18);
    }
  `,
})
export class MessageBubble {
  readonly message = input.required<Message>();

  protected readonly renderedHtml = computed(() =>
    this.message().role === 'assistant' ? renderMarkdownToHtml(this.message().content) : '',
  );

  protected onContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const button = target.closest('.copy-btn') as HTMLButtonElement | null;
    if (!button) {
      return;
    }
    const code = button.parentElement?.querySelector('code');
    const text = code?.textContent ?? '';
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        const original = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
          button.textContent = original;
        }, 1200);
      })
      .catch(() => {
        // Clipboard permission denied or unavailable — no-op.
      });
  }
}
