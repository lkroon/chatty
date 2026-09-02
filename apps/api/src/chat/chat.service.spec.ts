import type { ChatEvent, ChatRequest } from '@contracts/chat';
import { ChatService } from './chat.service';
import { ConversationStore } from './conversation-store';
import {
  OpencodeUpstreamError,
  OpencodeChatCompletionParams,
} from '../opencode/opencode-client.types';
import type { OpencodeService } from '../opencode/opencode.service';

class FakeConversationStore implements ConversationStore {
  startExchangeCalls: unknown[] = [];
  finalizeCalls: unknown[] = [];
  nextResult = { conversationId: 'conv-1', assistantMessageId: 'msg-1' };
  history = [{ role: 'user' as const, content: 'previous turn' }];

  async startExchange(input: {
    accountId: string;
    conversationId?: string;
    model: string;
    userContent: string;
  }) {
    this.startExchangeCalls.push(input);
    return this.nextResult;
  }

  async finalizeAssistantMessage(input: {
    assistantMessageId: string;
    content: string;
    aborted: boolean;
  }) {
    this.finalizeCalls.push(input);
  }

  async getHistory() {
    return this.history;
  }
}

class FakeUsageService {
  consumeCalls: string[] = [];
  result: { ok: true } | { ok: false; reason: 'LIMIT_EXCEEDED' } = {
    ok: true,
  };

  async consume(accountId: string) {
    this.consumeCalls.push(accountId);
    return this.result;
  }
}

function fakeOpencodeService(
  generatorFn: (params: OpencodeChatCompletionParams) => AsyncGenerator<
    { type: 'delta'; text: string } | { type: 'done'; finishReason: string }
  >,
): OpencodeService {
  return {
    streamChatCompletion: generatorFn,
  } as unknown as OpencodeService;
}

const body: ChatRequest = { model: 'glm-5.3', content: 'hello there' };

describe('ChatService', () => {
  it('calls usage.consume() before touching the conversation store or opencode', async () => {
    const order: string[] = [];
    const conversationStore = new FakeConversationStore();
    const originalStart = conversationStore.startExchange.bind(conversationStore);
    conversationStore.startExchange = async (input) => {
      order.push('startExchange');
      return originalStart(input);
    };
    const usageService = new FakeUsageService();
    const originalConsume = usageService.consume.bind(usageService);
    usageService.consume = async (accountId) => {
      order.push('usage.consume');
      return originalConsume(accountId);
    };

    async function* stream() {
      order.push('opencode.stream');
      yield { type: 'done' as const, finishReason: 'stop' };
    }

    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    expect(order).toEqual(['usage.consume', 'startExchange', 'opencode.stream']);
  });

  it('emits UPSTREAM error and does not call usage/store when accountId is missing', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    async function* stream() {
      yield { type: 'done' as const, finishReason: 'stop' };
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run(undefined, body, (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([
      { type: 'error', code: 'UPSTREAM', message: 'Not authenticated' },
    ]);
    expect(usageService.consumeCalls).toEqual([]);
    expect(conversationStore.startExchangeCalls).toEqual([]);
  });

  it('emits LIMIT_EXCEEDED and stops before the conversation store / upstream when usage.consume() rejects', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    usageService.result = { ok: false, reason: 'LIMIT_EXCEEDED' };
    async function* stream() {
      yield { type: 'done' as const, finishReason: 'stop' };
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([
      {
        type: 'error',
        code: 'LIMIT_EXCEEDED',
        message: 'Daily message limit reached',
      },
    ]);
    expect(conversationStore.startExchangeCalls).toEqual([]);
  });

  it('emits meta first (using startExchange\'s ids), then deltas, then done, and finalizes with the full accumulated text', async () => {
    const conversationStore = new FakeConversationStore();
    conversationStore.nextResult = {
      conversationId: 'conv-42',
      assistantMessageId: 'msg-42',
    };
    const usageService = new FakeUsageService();
    async function* stream() {
      yield { type: 'delta' as const, text: 'Hel' };
      yield { type: 'delta' as const, text: 'lo' };
      yield { type: 'done' as const, finishReason: 'stop' };
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([
      { type: 'meta', conversationId: 'conv-42', messageId: 'msg-42' },
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(conversationStore.finalizeCalls).toEqual([
      { assistantMessageId: 'msg-42', content: 'Hello', aborted: false },
    ]);
  });

  it('passes stored history to opencode after creating the current exchange', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    let upstreamMessages: OpencodeChatCompletionParams['messages'] | undefined;
    async function* stream(params: OpencodeChatCompletionParams) {
      upstreamMessages = params.messages;
      yield { type: 'done' as const, finishReason: 'stop' };
    }
    await new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    ).run(
      'acct-1',
      { ...body, conversationId: 'conv-1' },
      () => undefined,
      new AbortController().signal,
    );

    expect(upstreamMessages).toEqual([
      { role: 'user', content: 'previous turn' },
    ]);
  });

  it('maps a 429 OpencodeUpstreamError to a RATE_LIMIT ChatEvent and finalizes with whatever streamed so far', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    async function* stream(): AsyncGenerator<
      { type: 'delta'; text: string } | { type: 'done'; finishReason: string }
    > {
      yield { type: 'delta', text: 'partial' };
      throw new OpencodeUpstreamError(429, 'rate limited');
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([
      { type: 'meta', conversationId: 'conv-1', messageId: 'msg-1' },
      { type: 'delta', text: 'partial' },
      { type: 'error', code: 'RATE_LIMIT', message: 'Upstream rate limited' },
    ]);
    expect(conversationStore.finalizeCalls).toEqual([
      { assistantMessageId: 'msg-1', content: 'partial', aborted: false },
    ]);
  });

  it('maps a 500 OpencodeUpstreamError to an UPSTREAM ChatEvent', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    function stream(): AsyncGenerator<
      { type: 'delta'; text: string } | { type: 'done'; finishReason: string }
    > {
      return (async function* () {
        yield* [];
        throw new OpencodeUpstreamError(503, 'unavailable');
      })();
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([
      { type: 'meta', conversationId: 'conv-1', messageId: 'msg-1' },
      { type: 'error', code: 'UPSTREAM', message: 'Upstream error 503' },
    ]);
  });

  it('maps a non-2xx, non-429/5xx OpencodeUpstreamError to UPSTREAM with the status in the message', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    function stream(): AsyncGenerator<
      { type: 'delta'; text: string } | { type: 'done'; finishReason: string }
    > {
      return (async function* () {
        yield* [];
        throw new OpencodeUpstreamError(404, 'not found');
      })();
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    const errorEvent = events[events.length - 1] as Extract<
      ChatEvent,
      { type: 'error' }
    >;
    expect(errorEvent.type).toBe('error');
    expect(errorEvent.code).toBe('UPSTREAM');
    expect(errorEvent.message).toContain('404');
  });

  it('on client abort (signal set + upstream throws an AbortError), emits no error event and finalizes with aborted:true and the partial text', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    const abortController = new AbortController();

    async function* stream(): AsyncGenerator<
      { type: 'delta'; text: string } | { type: 'done'; finishReason: string }
    > {
      yield { type: 'delta', text: 'Hel' };
      abortController.abort();
      // Mirrors what a real fetch() reader.read() does once its signal
      // fires mid-stream.
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }

    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run(
      'acct-1',
      body,
      (e) => events.push(e),
      abortController.signal,
    );

    expect(events).toEqual([
      { type: 'meta', conversationId: 'conv-1', messageId: 'msg-1' },
      { type: 'delta', text: 'Hel' },
    ]);
    expect(conversationStore.finalizeCalls).toEqual([
      { assistantMessageId: 'msg-1', content: 'Hel', aborted: true },
    ]);
  });

  it('the defensive signal.aborted check stops emitting once abort is observed, even if the generator yields without throwing', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    const abortController = new AbortController();

    async function* stream(): AsyncGenerator<
      { type: 'delta'; text: string } | { type: 'done'; finishReason: string }
    > {
      yield { type: 'delta', text: 'Hel' };
      abortController.abort();
      yield { type: 'delta', text: 'lo (should not be emitted)' };
      yield { type: 'done', finishReason: 'stop' };
    }

    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
    );
    const events: ChatEvent[] = [];
    await service.run(
      'acct-1',
      body,
      (e) => events.push(e),
      abortController.signal,
    );

    expect(events).toEqual([
      { type: 'meta', conversationId: 'conv-1', messageId: 'msg-1' },
      { type: 'delta', text: 'Hel' },
    ]);
    expect(conversationStore.finalizeCalls).toEqual([
      { assistantMessageId: 'msg-1', content: 'Hel', aborted: true },
    ]);
  });
});
