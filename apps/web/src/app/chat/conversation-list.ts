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
      padding: 0.75rem;
      gap: 0.5rem;
      box-sizing: border-box;
    }

    .new-chat {
      font: inherit;
      padding: 0.5em 0.75em;
      border-radius: 6px;
      border: 1px solid var(--oc-border, #444);
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
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
      border-radius: 6px;
    }

    li.active {
      background: var(--oc-active, rgba(127, 127, 255, 0.15));
    }

    li.empty {
      opacity: 0.6;
      padding: 0.5em;
      font-size: 0.9em;
    }

    .title {
      flex: 1;
      text-align: left;
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      padding: 0.5em;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .delete {
      background: none;
      border: none;
      color: inherit;
      opacity: 0.6;
      cursor: pointer;
      font-size: 1.1em;
      padding: 0.25em 0.6em;
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
