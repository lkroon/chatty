import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, of, type Observable } from 'rxjs';
import type {
  ChatEvent,
  ChatRequest,
  ConversationDetail,
  ConversationListItem,
  Model,
} from '@contracts';

import { CHAT_API, ChatApi } from '../core/chat-api';
import { ChatStore } from '../core/chat-store';
import { ChatShell } from './chat-shell';

class TestChatApi implements ChatApi {
  private readonly seed: ConversationDetail = {
    id: 'seed-1',
    title: 'Welcome to chatty',
    messages: [],
  };

  /**
   * The in-flight response, driven by the test one event at a time.
   *
   * This used to be a fixed pipeline of rxjs `delay()`s that the test raced
   * with `setTimeout`s of its own, sampling the DOM at the exact millisecond
   * each event was scheduled to arrive. Whichever timer the browser happened
   * to run first decided the result, so on a loaded CI runner the spec failed
   * for reasons that had nothing to do with the component. Nothing here needs
   * wall-clock time: "progressively" means each event renders on its own, and
   * pushing them by hand tests that directly.
   */
  readonly events$ = new Subject<ChatEvent>();
  lastRequest: ChatRequest | null = null;

  listModels(): Observable<Model[]> {
    return of([{ id: 'test-model', label: 'Test model', family: 'test' }]);
  }

  listConversations(): Observable<ConversationListItem[]> {
    return of([{ id: this.seed.id, title: this.seed.title, updatedAt: new Date().toISOString() }]);
  }

  getConversation(): Observable<ConversationDetail> {
    return of(structuredClone(this.seed));
  }

  deleteConversation(): Observable<void> {
    return of(undefined);
  }

  sendChat(request: ChatRequest): Observable<ChatEvent> {
    this.lastRequest = request;
    return this.events$.asObservable();
  }
}

describe('ChatShell', () => {
  let api: TestChatApi;

  beforeEach(() => {
    api = new TestChatApi();
    TestBed.configureTestingModule({
      imports: [ChatShell],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).overrideComponent(ChatShell, {
      set: {
        providers: [{ provide: CHAT_API, useValue: api }, ChatStore],
      },
    });
  });

  it('creates and renders the header, sidebar, thread, and composer', () => {
    const fixture = TestBed.createComponent(ChatShell);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-model-picker')).toBeTruthy();
    expect(el.querySelector('app-conversation-list')).toBeTruthy();
    expect(el.querySelector('app-message-thread')).toBeTruthy();
    expect(el.querySelector('app-composer')).toBeTruthy();

    // Seed conversation from the test API loaded into the sidebar.
    expect(el.textContent).toContain('Welcome to chatty');
  });

  it('renders streamed deltas progressively into the thread as they arrive', () => {
    const fixture = TestBed.createComponent(ChatShell);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const textarea = el.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'hello world';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = el.querySelector('form.composer') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(api.lastRequest?.content).toBe('hello world');

    const streamed = () => el.querySelector('.markdown-body')?.textContent ?? '';

    // meta opens the response; nothing has streamed into the thread yet.
    api.events$.next({ type: 'meta', conversationId: 'test-conversation', messageId: 'm1' });
    fixture.detectChanges();
    const afterMeta = streamed();

    // Each delta has to reach the DOM on its own — the whole point of
    // streaming is that the text grows rather than appearing all at once.
    api.events$.next({ type: 'delta', text: 'You said: "hello world"' });
    fixture.detectChanges();
    const afterOneDelta = streamed();
    expect(afterOneDelta.length).toBeGreaterThan(afterMeta.length);

    api.events$.next({ type: 'delta', text: ' streamed' });
    fixture.detectChanges();
    const afterTwoDeltas = streamed();
    expect(afterTwoDeltas.length).toBeGreaterThan(afterOneDelta.length);

    api.events$.next({ type: 'done', finishReason: 'stop' });
    fixture.detectChanges();
    expect(el.textContent).toContain('You said: "hello world" streamed');
  });
});
