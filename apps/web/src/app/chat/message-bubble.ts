import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import type { Message } from '@contracts';

import { renderMarkdownToHtml } from '../core/markdown';

@Component({
  selector: 'app-message-bubble',
  imports: [],
  template: `
    <div
      class="msg"
      [class.msg--user]="message().role === 'user'"
      [class.msg--assistant]="message().role === 'assistant'"
    >
      <span class="msg__who">{{ message().role === 'user' ? 'You' : 'Chatty' }}</span>
      @if (message().role === 'assistant') {
        <div
          class="markdown-body"
          [innerHTML]="renderedHtml()"
          (click)="onContentClick($event)"
        ></div>
      } @else {
        <div class="msg__plain">{{ message().content }}</div>
      }
      @if (message().finishReason === 'aborted') {
        <p class="msg__note">Stopped before finishing.</p>
      }
    </div>
  `,
  // ViewEncapsulation.None: assistant content is rendered via [innerHTML]
  // (marked + DOMPurify output), which Angular never stamps with its
  // emulated-encapsulation content attribute — scoped selectors would
  // silently fail to match it. Class names below are namespaced
  // (`msg__*`, `markdown-body`) to avoid leaking into the rest of
  // the app now that these rules are global.
  encapsulation: ViewEncapsulation.None,
  styles: `
    /* Only the user's own messages are a block. An assistant reply runs the
       full column width behind a rule, because a 400-word answer inside an
       85%-width bubble is the thing that made long replies unreadable on a
       phone. The speaker label is what a bubble's shape used to say. */
    .msg {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      line-height: 1.5;
      word-wrap: break-word;
      font-size: 0.92rem;
    }

    .msg__who {
      font-family: var(--font-meta);
      font-size: 0.66rem;
      color: var(--oc-text-muted);
    }

    /* margin auto, not align-self: app-message-bubble (this component's
       host tag) is the actual flex item in app-message-thread's column
       layout, not this inner div — align-self on the div would be a no-op. */
    .msg--user {
      margin-left: auto;
      align-items: flex-end;
      max-width: min(26rem, 80%);
    }

    .msg--user .msg__plain,
    .msg--user .msg__note {
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      border-radius: var(--oc-r);
      padding: 0.45rem 0.7rem;
    }

    .msg--assistant {
      margin-right: auto;
      width: 100%;
      border-left: 2px solid var(--oc-rule);
      padding-left: 0.6rem;
    }

    .msg__plain {
      white-space: pre-wrap;
    }

    .msg__note {
      margin: 0.3em 0 0;
      font-size: 0.8em;
      color: var(--oc-text-muted);
    }

    .msg .markdown-body p {
      margin: 0.4em 0;
    }

    .msg .markdown-body p:first-child {
      margin-top: 0;
    }

    .msg .markdown-body p:last-child {
      margin-bottom: 0;
    }

    /* One ink for code in both themes: a code block that follows the theme
       would be near-white in Daylight, and the highlight colours marked
       emits are mixed for a dark ground. */
    .msg .markdown-body pre {
      overflow-x: auto;
      padding: 0.7em;
      border-radius: var(--oc-r);
      background: #0b0f14;
      color: #dbe4ee;
    }

    .msg .markdown-body code {
      font-family: var(--font-meta);
      font-size: 0.85em;
    }

    .msg--assistant .markdown-body :not(pre) > code {
      background: var(--oc-surface-2);
      border: 1px solid var(--oc-border);
      padding: 0.1em 0.35em;
      border-radius: var(--oc-r);
    }

    .msg .markdown-body a {
      color: var(--oc-accent-ink);
    }

    .msg .markdown-body .code-block {
      position: relative;
      margin: 0.5em 0;
    }

    .msg .markdown-body .copy-btn {
      position: absolute;
      top: 0.4em;
      right: 0.4em;
      font-family: var(--font-meta);
      font-size: 0.75em;
      padding: 0.25em 0.6em;
      border-radius: var(--oc-r);
      border: 1px solid rgba(219, 228, 238, 0.28);
      background: rgba(219, 228, 238, 0.1);
      color: #dbe4ee;
      cursor: pointer;
    }

    .msg .markdown-body .copy-btn:hover {
      background: rgba(219, 228, 238, 0.2);
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
