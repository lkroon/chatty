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
        placeholder="Message Chatty…"
        [value]="draft()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
      ></textarea>
      @if (store.isStreaming()) {
        <button type="button" class="round-btn stop-btn" (click)="store.cancelStreaming()" aria-label="Stop">
          <span class="stop-icon"></span>
        </button>
      } @else {
        <button type="submit" class="round-btn send-btn" [disabled]="!draft().trim()" aria-label="Send">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 10l13-7-4 7 4 7-13-7z" /></svg>
        </button>
      }
    </form>
  `,
  styles: `
    .composer {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      padding: 0.6rem 0.85rem;
      padding-bottom: calc(0.6rem + env(safe-area-inset-bottom));
      border-top: 1px solid var(--oc-border, #dcece4);
      background: var(--oc-surface, #fff);
      box-sizing: border-box;
    }

    textarea {
      flex: 1;
      resize: none;
      overflow-y: auto;
      max-height: ${MAX_TEXTAREA_HEIGHT_PX}px;
      min-height: 2.4em;
      font: inherit;
      font-size: 0.9rem;
      padding: 0.6em 1em;
      border-radius: 20px;
      border: 1px solid var(--oc-border, #dcece4);
      background: var(--oc-bg, #eef6f2);
      color: inherit;
    }

    .round-btn {
      flex-shrink: 0;
      width: 2.5em;
      height: 2.5em;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .round-btn svg {
      width: 1em;
      height: 1em;
    }

    .send-btn {
      background: var(--oc-border, #dcece4);
      color: var(--oc-text-muted, #6f7a76);
    }

    .send-btn:not(:disabled) {
      background: var(--oc-accent, #ff6f59);
      color: #fff;
    }

    .send-btn:disabled {
      cursor: default;
    }

    .stop-btn {
      background: var(--oc-accent, #ff6f59);
    }

    .stop-icon {
      width: 0.7em;
      height: 0.7em;
      border-radius: 2px;
      background: #fff;
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
