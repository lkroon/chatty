import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject, of } from 'rxjs';
import type { ChatEvent, ConversationDetail, ConversationListItem, Model } from '@contracts';

import { CHAT_API, ChatApi } from './chat-api';
import { ChatStore } from './chat-store';

class FakeChatApi implements ChatApi {
  models: Model[] = [
    { id: 'model-a', label: 'Model A', family: 'fam' },
    { id: 'model-b', label: 'Model B', family: 'fam' },
  ];
  conversations: ConversationListItem[] = [{ id: 'c1', title: 'First', updatedAt: 'now' }];
  detail: ConversationDetail = {
    id: 'c1',
    title: 'First',
    messages: [
      { id: 'm1', role: 'user', content: 'hi', createdAt: 'now', finishReason: null },
    ],
  };
  chatEvents$ = new Subject<ChatEvent>();

  listModels() {
    return of(this.models);
  }
  listConversations() {
    return of(this.conversations);
  }
  getConversation() {
    return of(this.detail);
  }
  deleteConversation() {
    return of(undefined);
  }
  sendChat() {
    return this.chatEvents$.asObservable();
  }
}

describe('ChatStore', () => {
  let store: ChatStore;
  let api: FakeChatApi;

  beforeEach(() => {
    // Jasmine randomises spec order, and several specs here seed
    // localStorage. Without this, whether a spec sees a stored model id
    // depends on what ran before it.
    localStorage.removeItem('oc-model');
    api = new FakeChatApi();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ChatStore, { provide: CHAT_API, useValue: api }],
    });
    store = TestBed.inject(ChatStore);
  });

  it('loads models and conversations on construction', () => {
    expect(store.models()).toEqual(api.models);
    expect(store.conversations()).toEqual(api.conversations);
  });

  it('selects the first model when nothing is stored', () => {
    expect(store.selectedModelId()).toBe('model-a');
  });

  it('falls back to the first model when the stored id is stale', () => {
    localStorage.setItem('oc-model', 'model-does-not-exist');
    TestBed.resetTestingModule();
    api = new FakeChatApi();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ChatStore, { provide: CHAT_API, useValue: api }],
    });
    store = TestBed.inject(ChatStore);
    expect(store.selectedModelId()).toBe('model-a');
    localStorage.removeItem('oc-model');
  });

  it('prefers glm-5.3-flash over list order when nothing is stored', () => {
    TestBed.resetTestingModule();
    // The outer beforeEach already built a store, and building one *writes*
    // the resolved id back to localStorage. Clear it after that, or this spec
    // is really testing the stored-preference path.
    localStorage.removeItem('oc-model');
    api = new FakeChatApi();
    // Deliberately not first: models[0] is what the old behaviour picked, and
    // upstream list order is nobody's decision.
    api.models = [
      { id: 'model-a', label: 'Model A', family: 'fam' },
      { id: 'glm-5.3-flash', label: 'glm-5.3-flash', family: 'opencode' },
    ];
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ChatStore, { provide: CHAT_API, useValue: api }],
    });
    store = TestBed.inject(ChatStore);
    expect(store.selectedModelId()).toBe('glm-5.3-flash');
  });

  it('lets a stored choice beat the preferred default', () => {
    localStorage.setItem('oc-model', 'model-a');
    TestBed.resetTestingModule();
    api = new FakeChatApi();
    api.models = [
      { id: 'model-a', label: 'Model A', family: 'fam' },
      { id: 'glm-5.3-flash', label: 'glm-5.3-flash', family: 'opencode' },
    ];
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ChatStore, { provide: CHAT_API, useValue: api }],
    });
    store = TestBed.inject(ChatStore);
    expect(store.selectedModelId()).toBe('model-a');
    localStorage.removeItem('oc-model');
  });

  it('keeps a stored model id that is still present', () => {
    localStorage.setItem('oc-model', 'model-b');
    TestBed.resetTestingModule();
    api = new FakeChatApi();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ChatStore, { provide: CHAT_API, useValue: api }],
    });
    store = TestBed.inject(ChatStore);
    expect(store.selectedModelId()).toBe('model-b');
    localStorage.removeItem('oc-model');
  });

  it('loads a conversation detail on select', () => {
    store.selectConversation('c1');
    expect(store.activeConversationId()).toBe('c1');
    expect(store.messages()).toEqual(api.detail.messages);
    expect(store.isLoadingConversation()).toBeFalse();
  });

  it('deletes a conversation and clears active state if it was selected', () => {
    store.selectConversation('c1');
    store.deleteConversation('c1');
    expect(store.conversations()).toEqual([]);
    expect(store.activeConversationId()).toBeNull();
    expect(store.messages()).toEqual([]);
  });

  it('streams deltas progressively and finalizes into a message on done', () => {
    store.send('hello');
    expect(store.isStreaming()).toBeTrue();
    expect(store.messages().at(-1)).toEqual(
      jasmine.objectContaining({ role: 'user', content: 'hello' }),
    );

    api.chatEvents$.next({ type: 'meta', conversationId: 'c1', messageId: 'm2' });
    api.chatEvents$.next({ type: 'delta', text: 'Hel' });
    expect(store.streamingText()).toBe('Hel');
    api.chatEvents$.next({ type: 'delta', text: 'lo!' });
    expect(store.streamingText()).toBe('Hello!');
    expect(store.isStreaming()).toBeTrue();

    api.chatEvents$.next({ type: 'done', finishReason: 'stop' });
    expect(store.isStreaming()).toBeFalse();
    expect(store.streamingText()).toBe('');
    expect(store.messages().at(-1)).toEqual(
      jasmine.objectContaining({ id: 'm2', role: 'assistant', content: 'Hello!' }),
    );
  });

  it('surfaces an error event without adding an assistant message', () => {
    store.send('hello');
    api.chatEvents$.next({ type: 'error', code: 'LIMIT_EXCEEDED', message: 'Limit exceeded.' });
    expect(store.isStreaming()).toBeFalse();
    expect(store.error()).toBe('Limit exceeded.');
    expect(store.messages().some((m) => m.role === 'assistant')).toBeFalse();
  });

  it('two tool events with the same callId produce one chip, not two, and it survives into the finalized message', () => {
    store.send('search something');
    api.chatEvents$.next({ type: 'meta', conversationId: 'c1', messageId: 'm2' });
    api.chatEvents$.next({
      type: 'tool',
      chip: { callId: 'call-1', name: 'web_search', status: 'running', label: 'Searching…', sources: [] },
    });
    expect(store.streamingToolCalls().length).toBe(1);
    api.chatEvents$.next({
      type: 'tool',
      chip: {
        callId: 'call-1',
        name: 'web_search',
        status: 'done',
        label: 'Searched "something"',
        sources: [{ title: 'X', url: 'https://x.example' }],
      },
    });
    expect(store.streamingToolCalls().length).toBe(1);
    expect(store.streamingToolCalls()[0].status).toBe('done');

    api.chatEvents$.next({ type: 'delta', text: 'answer' });
    api.chatEvents$.next({ type: 'done', finishReason: 'stop' });

    const finalized = store.messages().at(-1);
    expect(finalized?.toolCalls?.length).toBe(1);
    expect(finalized?.toolCalls?.[0].status).toBe('done');
    expect(store.streamingToolCalls()).toEqual([]);
  });

  it('a thinking event followed by a delta clears the thinking flag', () => {
    store.send('hello');
    api.chatEvents$.next({ type: 'meta', conversationId: 'c1', messageId: 'm2' });
    api.chatEvents$.next({ type: 'thinking' });
    expect(store.streamingThinking()).toBeTrue();

    api.chatEvents$.next({ type: 'delta', text: 'Hi' });
    expect(store.streamingThinking()).toBeFalse();
  });

  it('a finalized message with no tool calls has no toolCalls field', () => {
    store.send('hello');
    api.chatEvents$.next({ type: 'meta', conversationId: 'c1', messageId: 'm2' });
    api.chatEvents$.next({ type: 'delta', text: 'Hi' });
    api.chatEvents$.next({ type: 'done', finishReason: 'stop' });
    expect(store.messages().at(-1)?.toolCalls).toBeUndefined();
  });

  it('ignores an unknown future event type rather than throwing', () => {
    store.send('hello');
    expect(() =>
      api.chatEvents$.next({ type: 'from-the-future' } as unknown as ChatEvent),
    ).not.toThrow();
    expect(store.isStreaming()).toBeTrue();
  });

  it('ignores an empty send while idle and while already streaming', () => {
    const before = store.messages().length;
    store.send('   ');
    expect(store.messages().length).toBe(before);

    store.send('first');
    const afterFirst = store.messages().length;
    store.send('second');
    expect(store.messages().length).toBe(afterFirst);
  });
});
