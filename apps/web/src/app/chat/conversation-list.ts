import { Component, inject, output } from '@angular/core';

import { ChatStore } from '../core/chat-store';

@Component({
  selector: 'app-conversation-list',
  imports: [],
  template: `
    <div class="conversation-list">
      <button type="button" class="new-chat" (click)="onNew()">+ New chat</button>
      <ul>
        @for (c of store.conversations(); track c.id) {
          <li [class.active]="c.id === store.activeConversationId()">
            <button type="button" class="title" (click)="onSelect(c.id)">{{ c.title }}</button>
            <button
              type="button"
              class="delete"
              aria-label="Delete conversation"
              (click)="onDelete($event, c.id)"
            >
              ×
            </button>
          </li>
        } @empty {
          <li class="empty">No conversations yet.</li>
        }
      </ul>
    </div>
  `,
  styles: `
    .conversation-list {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
      padding: 0 0.7rem 0.7rem;
      gap: 0.7rem;
      box-sizing: border-box;
    }

    .new-chat {
      font-family: var(--font-ui);
      font-size: 0.82rem;
      font-weight: 600;
      padding: 0.7em 0.9em;
      border-radius: var(--oc-r);
      border: none;
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      cursor: pointer;
      text-align: center;
      flex-shrink: 0;
    }

    .new-chat:hover {
      opacity: 0.92;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    li {
      display: flex;
      align-items: center;
      border-radius: var(--oc-r);
    }

    li.active {
      background: var(--oc-accent-soft);
    }

    li.active .title {
      color: var(--oc-accent-ink);
      font-weight: 600;
    }

    li.empty {
      opacity: 0.6;
      padding: 0.5em;
      font-size: 0.9em;
      color: var(--oc-text-muted);
    }

    .title {
      flex: 1;
      text-align: left;
      background: none;
      border: none;
      color: var(--oc-text-muted);
      font: inherit;
      font-size: 0.85rem;
      padding: 0.6em 0.7em;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .delete {
      background: none;
      border: none;
      color: inherit;
      opacity: 0.45;
      cursor: pointer;
      font-size: 1.1em;
      padding: 0.25em 0.75em;
      flex-shrink: 0;
    }

    .delete:hover {
      opacity: 1;
    }
  `,
})
export class ConversationList {
  protected readonly store = inject(ChatStore);

  /** Emitted after a select/new-chat action, so the shell can close a mobile drawer. */
  readonly activated = output<void>();

  protected onNew(): void {
    this.store.newConversation();
    this.activated.emit();
  }

  protected onSelect(id: string): void {
    this.store.selectConversation(id);
    this.activated.emit();
  }

  protected onDelete(event: Event, id: string): void {
    event.stopPropagation();
    this.store.deleteConversation(id);
  }
}
