import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject, of } from 'rxjs';
import type { ChatEvent, ConversationPage, Model, ProposalCard } from '@contracts';

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
});
