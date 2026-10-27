import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject, of } from 'rxjs';
import type {
  ChatEvent,
  ConversationPage,
  Model,
  ProposalCard,
  SearchHit,
} from '@contracts';

import { CHAT_API, ChatApi } from '../core/chat-api';
import { ChatStore } from '../core/chat-store';
import { testProposalCard } from '../core/test-proposal';
import { ConversationList } from './conversation-list';

/**
 * Stands in for the browser's IntersectionObserver so tests can fire the
 * callback by hand instead of depending on real scroll geometry.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observe = jasmine.createSpy('observe');
  readonly disconnect = jasmine.createSpy('disconnect');

  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
}

class StubChatApi implements ChatApi {
  /** Served in order: page one on construction, page two on load-more. */
  readonly pages: ConversationPage[] = [
    { items: [{ id: 'c1', title: 'First', updatedAt: 'now' }], nextCursor: 'cursor-1' },
    { items: [{ id: 'c2', title: 'Second', updatedAt: 'now' }], nextCursor: null },
  ];
  /** Index of the next page to serve; readable by tests to count API calls. */
  nextPage = 0;
  searchHits: SearchHit[] = [
    {
      conversationId: 'c1',
      conversationTitle: 'Search hit title',
      messageId: 'm-search-1',
      role: 'user',
      snippet: 'the meaning of life',
      score: 0.94,
      createdAt: 'now',
    },
  ];

  listModels() {
    return of<Model[]>([]);
  }

  listConversationPage() {
    const page = this.pages[this.nextPage] ?? { items: [], nextCursor: null };
    this.nextPage++;
    return of(page);
  }

  getConversation() {
    return of({ id: 'c1', title: 'First', messages: [] });
  }
  search() {
    return of(this.searchHits);
  }

  deleteConversation() {
    return of(undefined);
  }

  sendChat() {
    return of<ChatEvent>();
  }

  confirmProposal() {
    return of<ProposalCard>(testProposalCard({ status: 'executed', confirmable: false }));
  }

  discardProposal() {
    return of<ProposalCard>(testProposalCard({ status: 'discarded', confirmable: false }));
  }
}

describe('ConversationList', () => {
  let api: StubChatApi;
  const realIntersectionObserver = window.IntersectionObserver;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    api = new StubChatApi();
    window.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ConversationList],
      providers: [
        provideZonelessChangeDetection(),
        ChatStore,
        { provide: CHAT_API, useValue: api },
      ],
    });
  });

  afterEach(() => {
    window.IntersectionObserver = realIntersectionObserver;
  });

  function setup() {
    const fixture = TestBed.createComponent(ConversationList);
    // Runs ngAfterViewInit, which wires the observer to the sentinel.
    fixture.detectChanges();
    return { fixture, store: TestBed.inject(ChatStore) };
  }

  function intersect(observer: FakeIntersectionObserver, isIntersecting: boolean): void {
    observer.callback(
      [{ isIntersecting } as unknown as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  }

  it('renders a sentinel row after the conversations', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ul > li.sentinel')).toBeTruthy();
    expect(el.textContent).toContain('First');
  });

  it('wires the sentinel to the observer', () => {
    setup();
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    expect(observer.observe).toHaveBeenCalled();
  });

  it('calls store.loadMoreConversations when the sentinel intersects', () => {
    const { store } = setup();
    const spy = spyOn(store, 'loadMoreConversations');
    intersect(FakeIntersectionObserver.instances.at(-1)!, true);
    expect(spy).toHaveBeenCalled();
  });

  it('does not call load-more when the sentinel is not intersecting', () => {
    const { store } = setup();
    const spy = spyOn(store, 'loadMoreConversations');
    intersect(FakeIntersectionObserver.instances.at(-1)!, false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('loads the next page end to end when the sentinel intersects', () => {
    const { fixture } = setup();
    intersect(FakeIntersectionObserver.instances.at(-1)!, true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('First');
    expect(el.textContent).toContain('Second');
    // Page two exhausted the list: a repeat intersection must be a no-op,
    // not an API call.
    const calls = api.nextPage;
    intersect(FakeIntersectionObserver.instances.at(-1)!, true);
    expect(api.nextPage).toBe(calls);
  });

  it('shows a Loading… row while the next page is in flight, and clears it after', () => {
    const { fixture } = setup();
    const pending = new Subject<ConversationPage>();
    spyOn(api, 'listConversationPage').and.returnValue(pending);
    intersect(FakeIntersectionObserver.instances.at(-1)!, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading…');

    pending.next({ items: [], nextCursor: null });
    pending.complete();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Loading…');
  });

  it('disconnects the observer when the component is destroyed', () => {
    const { fixture } = setup();
    const observer = FakeIntersectionObserver.instances.at(-1)!;
    fixture.destroy();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  describe('search', () => {
    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    function typeQuery(fixture: { detectChanges: () => void; nativeElement: HTMLElement }, query: string): void {
      const input = fixture.nativeElement.querySelector<HTMLInputElement>('input.search')!;
      input.value = query;
      input.dispatchEvent(new Event('input'));
      jasmine.clock().tick(300);
      fixture.detectChanges();
    }

    it('renders hits in place of conversations while a query is active', () => {
      const { fixture } = setup();
      typeQuery(fixture, 'meaning');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Search hit title');
      expect(el.textContent).toContain('the meaning of life');
      // The paginated conversation list (and its rows) is hidden, not merged
      // into the hits.
      expect(el.querySelectorAll('li .title').length).toBe(1);
      expect(el.textContent).not.toContain('No conversations yet.');
    });

    it('returns to the conversation list when the query is emptied', () => {
      const { fixture } = setup();
      typeQuery(fixture, 'meaning');
      typeQuery(fixture, '');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('First');
      expect(el.textContent).not.toContain('Search hit title');
    });

    it('clicking a hit selects that conversation and clears the search', () => {
      const { fixture, store } = setup();
      const spy = spyOn(store, 'selectConversation');
      typeQuery(fixture, 'meaning');
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('li.hit .title')!.click();
      expect(spy).toHaveBeenCalledWith('c1');
      expect(store.isSearchActive()).toBeFalse();
    });

    it('does not load more conversations while a search is active', () => {
      const { fixture, store } = setup();
      const spy = spyOn(store, 'loadMoreConversations');
      typeQuery(fixture, 'meaning');
      intersect(FakeIntersectionObserver.instances.at(-1)!, true);
      expect(spy).not.toHaveBeenCalled();
    });

    it('shows the empty state for a query with no hits', () => {
      const { fixture } = setup();
      api.searchHits = [];
      typeQuery(fixture, 'nothing matches');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('No matching messages.');
    });
  });
});
