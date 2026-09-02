import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { concat, delay, of, type Observable } from 'rxjs';
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
    const conversationId = request.conversationId ?? 'test-conversation';
    const events: ChatEvent[] = [
      { type: 'meta', conversationId, messageId: 'test-message' },
      { type: 'delta', text: `You said: "${request.content}"` },
      { type: 'delta', text: ' streamed' },
      { type: 'done', finishReason: 'stop' },
    ];
    return concat(
      of(events[0]),
      of(events[1]).pipe(delay(35)),
      of(events[2]).pipe(delay(35)),
      of(events[3]).pipe(delay(35)),
    ).pipe(delay(150));
  }
}

describe('ChatShell', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ChatShell],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).overrideComponent(ChatShell, {
      set: {
        providers: [{ provide: CHAT_API, useClass: TestChatApi }, ChatStore],
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

  it('renders streamed deltas progressively into the thread as they arrive', async () => {
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

    // meta event fires after 150ms; nothing streamed into the thread yet.
    await sleep(150);
    fixture.detectChanges();
    const afterMeta = el.querySelector('.markdown-body')?.textContent ?? '';

    // Advance a couple of delta ticks and confirm the streamed text grows
    // incrementally rather than appearing all at once.
    await sleep(35);
    fixture.detectChanges();
    const afterOneDelta = el.querySelector('.markdown-body')?.textContent ?? '';
    expect(afterOneDelta.length).toBeGreaterThan(afterMeta.length);

    await sleep(35);
    fixture.detectChanges();
    const afterTwoDeltas = el.querySelector('.markdown-body')?.textContent ?? '';
    expect(afterTwoDeltas.length).toBeGreaterThan(afterOneDelta.length);

    await sleep(100);
    fixture.detectChanges();
    expect(el.textContent).toContain('You said: "hello world"');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
