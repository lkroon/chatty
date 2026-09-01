import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';

import { ChatStore } from '../core/chat-store';

const MAX_TEXTAREA_HEIGHT_PX = 200;

@Component({
  selector: 'app-composer',
  imports: [],
  template: `
    <form class="composer" (submit)="onSubmit($event)">
      <textarea
        #textareaEl
        name="message"
        rows="1"
        placeholder="Message opencode-chat…"
        [value]="draft()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
      ></textarea>
      @if (store.isStreaming()) {
        <button type="button" class="stop-btn" (click)="store.cancelStreaming()">Stop</button>
      } @else {
        <button type="submit" class="send-btn" [disabled]="!draft().trim()">Send</button>
      }
    </form>
  `,
  styles: `
    .composer {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      padding: 0.75rem;
      padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
      border-top: 1px solid var(--oc-border, #333);
      box-sizing: border-box;
    }

    textarea {
      flex: 1;
      resize: none;
      overflow-y: auto;
      max-height: ${MAX_TEXTAREA_HEIGHT_PX}px;
      min-height: 2.5em;
      font: inherit;
      padding: 0.6em 0.75em;
      border-radius: 8px;
      border: 1px solid var(--oc-border, #444);
      background: var(--oc-surface, #1e1e1e);
      color: inherit;
    }

    .send-btn,
    .stop-btn {
      font: inherit;
      padding: 0.6em 1.1em;
      border-radius: 8px;
      border: none;
      cursor: pointer;
    }

    .send-btn {
      background: var(--oc-accent, #2b5fd9);
      color: #fff;
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .stop-btn {
      background: var(--oc-error, #a23b3b);
      color: #fff;
    }
  `,
})
export class Composer {
  protected readonly store = inject(ChatStore);
  protected readonly draft = signal('');
  private readonly textareaEl = viewChild.required<ElementRef<HTMLTextAreaElement>>('textareaEl');

  /** Desktop (fine pointer, e.g. mouse/trackpad): Enter sends, Shift+Enter inserts a newline.
   *  Touch (coarse pointer): Enter inserts a newline; sending happens only via the button. */
  private isFinePointer(): boolean {
    return typeof matchMedia === 'function' ? matchMedia('(pointer: fine)').matches : true;
  }

  protected onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }
    if (!this.isFinePointer()) {
      return;
    }
    event.preventDefault();
    this.send();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.send();
  }

  private send(): void {
    const content = this.draft();
    if (!content.trim() || this.store.isStreaming()) {
      return;
    }
    this.store.send(content);
    this.draft.set('');
    const el = this.textareaEl().nativeElement;
    el.value = '';
    el.style.height = 'auto';
  }
}
