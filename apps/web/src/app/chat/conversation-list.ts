import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  output,
  viewChild,
} from '@angular/core';

import { ChatStore } from '../core/chat-store';

@Component({
  selector: 'app-conversation-list',
  imports: [],
  template: `
    <div class="conversation-list">
      <button type="button" class="new-chat" (click)="onNew()">+ New chat</button>
      <input
        class="search"
        type="search"
        placeholder="Search chats…"
        aria-label="Search conversations"
        [value]="store.searchQuery()"
        (input)="onSearchInput($event)"
      />
      <ul>
        @if (store.isSearchActive()) {
          @for (hit of store.searchHits(); track hit.messageId) {
            <li class="hit">
              <button type="button" class="title" (click)="onSelectHit(hit.conversationId)">
                <span class="hit-title">{{ hit.conversationTitle }}</span>
                <span class="hit-snippet">{{ hit.snippet }}</span>
                <span class="hit-score">{{ formatScore(hit.score) }}</span>
              </button>
            </li>
          } @empty {
            <li class="empty">{{ store.isSearching() ? 'Searching…' : 'No matching messages.' }}</li>
          }
        } @else {
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
          @if (store.isLoadingMore()) {
            <li class="loading">Loading…</li>
          }
        }
        <li class="sentinel" #sentinel></li>
      </ul>
    </div>
  `,
  styles: `
    // Same as message-thread's :host rule: the .conversation-list div's
    // overflow-y: auto only scrolls anything if this host is sized within
    // chat-shell's sidebar flex column. Without flex: 1/min-height: 0 the
    // host shrinkwraps to the whole list, the div grows unbounded, and the
    // sidebar just clips — no scrollbar, and the load-more sentinel sits
    // forever outside the viewport so IntersectionObserver never fires.
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    .conversation-list {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
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

    .search {
      font-family: var(--font-ui);
      font-size: 0.82rem;
      padding: 0.55em 0.9em;
      border-radius: var(--oc-r);
      border: 1px solid var(--oc-accent-soft);
      background: none;
      color: inherit;
      flex-shrink: 0;
    }

    .search:focus {
      outline: 1px solid var(--oc-accent);
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

    li.sentinel {
      height: 1px;
      flex-shrink: 0;
    }

    li.loading {
      opacity: 0.6;
      padding: 0.5em;
      font-size: 0.9em;
      color: var(--oc-text-muted);
    }

    li.hit .title {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.15em;
      white-space: normal;
    }

    .hit-title {
      font-size: 0.85rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hit-snippet {
      font-size: 0.78rem;
      opacity: 0.75;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hit-score {
      font-size: 0.7rem;
      opacity: 0.6;
      text-align: right;
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
export class ConversationList implements AfterViewInit, OnDestroy {
  protected readonly store = inject(ChatStore);

  /** Emitted after a select/new-chat action, so the shell can close a mobile drawer. */
  readonly activated = output<void>();

  private readonly sentinel =
    viewChild.required<ElementRef<HTMLLIElement>>('sentinel');
  private observer: IntersectionObserver | null = null;

  ngAfterViewInit(): void {
    // IntersectionObserver over a zero-content sentinel row: the browser
    // does the scroll math, no (scroll) handler needed. The store guards
    // exhaustion (null cursor) and double-fires, so the callback can call
    // load-more unconditionally — except while a search is active: then
    // the hits list is showing, not the paginated conversations, and
    // loading more pages in the background would be wasted work.
    this.observer = new IntersectionObserver((entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        !this.store.isSearchActive()
      ) {
        this.store.loadMoreConversations();
      }
    });
    this.observer.observe(this.sentinel().nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  protected onNew(): void {
    this.store.newConversation();
    this.activated.emit();
  }

  protected onSelect(id: string): void {
    this.store.selectConversation(id);
    this.activated.emit();
  }

  /** A search hit opens its conversation and closes the search. */
  protected onSelectHit(conversationId: string): void {
    this.store.clearSearch();
    this.onSelect(conversationId);
  }

  protected onSearchInput(event: Event): void {
    this.store.onSearchInput((event.target as HTMLInputElement).value);
  }

  /** "94%" — enough to rank visually, without implying real percentages. */
  protected formatScore(score: number): string {
    return `${Math.max(0, Math.min(1, score) * 100).toFixed(0)}%`;
  }

  protected onDelete(event: Event, id: string): void {
    event.stopPropagation();
    this.store.deleteConversation(id);
  }
}
