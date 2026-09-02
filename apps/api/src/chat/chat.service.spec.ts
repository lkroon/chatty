import type { ChatEvent, ChatRequest, ToolCallChip } from '@contracts/chat';
import { ChatService } from './chat.service';
import { ConversationStore } from './conversation-store';
import {
  OpencodeUpstreamError,
  OpencodeChatCompletionParams,
  OpencodeStreamChunk,
} from '../opencode/opencode-client.types';
import type { OpencodeService } from '../opencode/opencode.service';
import { MAX_TOOL_ROUNDS } from '../tools/tool-budget';
import type { ToolExecutionResult, ToolRuntime } from '../tools/tool-runtime';
import { TOOL_DEFINITIONS } from '../tools/tool-definitions';

class FakeConversationStore implements ConversationStore {
  startExchangeCalls: unknown[] = [];
  finalizeCalls: unknown[] = [];
  saveToolCallsCalls: { assistantMessageId: string; chips: ToolCallChip[] }[] = [];
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
    cost?: number | null;
  }) {
    this.finalizeCalls.push(input);
  }

  async saveToolCalls(input: { assistantMessageId: string; chips: ToolCallChip[] }) {
    this.saveToolCallsCalls.push(input);
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
  generatorFn: (params: OpencodeChatCompletionParams) => AsyncGenerator<OpencodeStreamChunk>,
): OpencodeService {
  return {
    streamChatCompletion: generatorFn,
  } as unknown as OpencodeService;
}

/** A no-op tool runtime — used by every test that doesn't exercise the tool loop (WEB_SEARCH_ENABLED unset). */
class NoopToolRuntime implements ToolRuntime {
  definitions() {
    return TOOL_DEFINITIONS;
  }
  async execute(): Promise<ToolExecutionResult> {
    throw new Error('NoopToolRuntime.execute should never be called with tools disabled');
  }
}

class FakeToolRuntime implements ToolRuntime {
  executeCalls: { name: string; rawArguments: string }[] = [];
  results: ToolExecutionResult[] = [];

  definitions() {
    return TOOL_DEFINITIONS;
  }

  async execute(call: { name: string; rawArguments: string }): Promise<ToolExecutionResult> {
    this.executeCalls.push(call);
    return (
      this.results.shift() ?? {
        status: 'done',
        content: 'no more canned results',
        label: 'done',
        sources: [],
      }
    );
  }
}

const body: ChatRequest = { model: 'glm-5.3', content: 'hello there' };

function doneChunk(finishReason: string, extra: Partial<Extract<OpencodeStreamChunk, { type: 'done' }>> = {}) {
  return { type: 'done' as const, finishReason, toolCalls: undefined, cost: null, ...extra };
}

describe('ChatService', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

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
      yield doneChunk('stop');
    }

    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    expect(order).toEqual(['usage.consume', 'startExchange', 'opencode.stream']);
  });

  it('emits UPSTREAM error and does not call usage/store when accountId is missing', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    async function* stream() {
      yield doneChunk('stop');
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
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
      yield doneChunk('stop');
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
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
      yield doneChunk('stop');
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
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
      { assistantMessageId: 'msg-42', content: 'Hello', aborted: false, cost: null },
    ]);
    // Called once even with no tool calls made (empty array, no-op per the interface doc).
    expect(conversationStore.saveToolCallsCalls).toEqual([
      { assistantMessageId: 'msg-42', chips: [] },
    ]);
  });

  it('prepends a system message ahead of stored history, and (tools disabled) sends no tools param', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    let upstreamParams: OpencodeChatCompletionParams | undefined;
    async function* stream(params: OpencodeChatCompletionParams) {
      upstreamParams = params;
      yield doneChunk('stop');
    }
    await new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
    ).run(
      'acct-1',
      { ...body, conversationId: 'conv-1' },
      () => undefined,
      new AbortController().signal,
    );

    expect(upstreamParams?.tools).toBeUndefined();
    expect(upstreamParams?.messages).toEqual([
      { role: 'system', content: expect.stringContaining('helpful assistant') },
      { role: 'user', content: 'previous turn' },
    ]);
    expect((upstreamParams?.messages[0].content ?? '')).not.toContain('search the web');
  });

  it('maps a 429 OpencodeUpstreamError to a RATE_LIMIT ChatEvent and finalizes with whatever streamed so far', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    async function* stream(): AsyncGenerator<OpencodeStreamChunk> {
      yield { type: 'delta', text: 'partial' };
      throw new OpencodeUpstreamError(429, 'rate limited');
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
    );
    const events: ChatEvent[] = [];
    await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([
      { type: 'meta', conversationId: 'conv-1', messageId: 'msg-1' },
      { type: 'delta', text: 'partial' },
      { type: 'error', code: 'RATE_LIMIT', message: 'Upstream rate limited' },
    ]);
    expect(conversationStore.finalizeCalls).toEqual([
      { assistantMessageId: 'msg-1', content: 'partial', aborted: false, cost: null },
    ]);
  });

  it('maps a 500 OpencodeUpstreamError to an UPSTREAM ChatEvent', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    function stream(): AsyncGenerator<OpencodeStreamChunk> {
      return (async function* () {
        yield* [];
        throw new OpencodeUpstreamError(503, 'unavailable');
      })();
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
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
    function stream(): AsyncGenerator<OpencodeStreamChunk> {
      return (async function* () {
        yield* [];
        throw new OpencodeUpstreamError(404, 'not found');
      })();
    }
    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
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

    async function* stream(): AsyncGenerator<OpencodeStreamChunk> {
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
      new NoopToolRuntime(),
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
      { assistantMessageId: 'msg-1', content: 'Hel', aborted: true, cost: null },
    ]);
  });

  it('the defensive signal.aborted check stops emitting once abort is observed, even if the generator yields without throwing', async () => {
    const conversationStore = new FakeConversationStore();
    const usageService = new FakeUsageService();
    const abortController = new AbortController();

    async function* stream(): AsyncGenerator<OpencodeStreamChunk> {
      yield { type: 'delta', text: 'Hel' };
      abortController.abort();
      yield { type: 'delta', text: 'lo (should not be emitted)' };
      yield doneChunk('stop');
    }

    const service = new ChatService(
      conversationStore,
      usageService,
      fakeOpencodeService(stream),
      new NoopToolRuntime(),
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
      { assistantMessageId: 'msg-1', content: 'Hel', aborted: true, cost: null },
    ]);
  });

  describe('tool loop (Wave 1.5, WEB_SEARCH_ENABLED=true)', () => {
    beforeEach(() => {
      process.env.WEB_SEARCH_ENABLED = 'true';
      process.env.TOOL_CAPABLE_MODELS = 'glm-5.3';
    });

    it('a fake upstream that requests one tool call then answers produces tool(running) -> tool(done) -> deltas -> one done, and exactly two upstream calls', async () => {
      const conversationStore = new FakeConversationStore();
      const usageService = new FakeUsageService();
      const toolRuntime = new FakeToolRuntime();
      toolRuntime.results = [
        {
          status: 'done',
          content: '1. Hacker News\nhttps://news.ycombinator.com\ntop stories',
          label: 'Searched "hacker news"',
          sources: [{ title: 'Hacker News', url: 'https://news.ycombinator.com' }],
        },
      ];

      let calls = 0;
      let seenToolsOnFirstCall: unknown;
      let seenToolsOnSecondCall: unknown;
      async function* stream(params: OpencodeChatCompletionParams): AsyncGenerator<OpencodeStreamChunk> {
        calls += 1;
        if (calls === 1) {
          seenToolsOnFirstCall = params.tools;
          yield doneChunk('tool_calls', {
            toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{"query":"hacker news"}' }],
          });
        } else {
          seenToolsOnSecondCall = params.tools;
          yield { type: 'delta', text: 'The top story is ' };
          yield { type: 'delta', text: 'X.' };
          yield doneChunk('stop');
        }
      }

      const service = new ChatService(
        conversationStore,
        usageService,
        fakeOpencodeService(stream),
        toolRuntime,
      );
      const events: ChatEvent[] = [];
      await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

      expect(calls).toBe(2);
      expect(seenToolsOnFirstCall).toBeDefined();
      expect(seenToolsOnSecondCall).toBeDefined(); // round 2 of 3 allowed rounds still offers tools
      expect(events[0]).toEqual({ type: 'meta', conversationId: 'conv-1', messageId: 'msg-1' });
      expect(events[1]).toEqual({
        type: 'tool',
        chip: { callId: 'call-1', name: 'web_search', status: 'running', label: 'Searching…', sources: [] },
      });
      expect(events[2]).toEqual({
        type: 'tool',
        chip: {
          callId: 'call-1',
          name: 'web_search',
          status: 'done',
          label: 'Searched "hacker news"',
          sources: [{ title: 'Hacker News', url: 'https://news.ycombinator.com' }],
        },
      });
      expect(events[3]).toEqual({ type: 'delta', text: 'The top story is ' });
      expect(events[4]).toEqual({ type: 'delta', text: 'X.' });
      expect(events[5]).toEqual({ type: 'done', finishReason: 'stop' });
      expect(events).toHaveLength(6);

      expect(toolRuntime.executeCalls).toEqual([
        { name: 'web_search', rawArguments: '{"query":"hacker news"}' },
      ]);
      expect(conversationStore.finalizeCalls).toEqual([
        {
          assistantMessageId: 'msg-1',
          content: 'The top story is X.',
          aborted: false,
          cost: null,
        },
      ]);
      expect(conversationStore.saveToolCallsCalls).toEqual([
        {
          assistantMessageId: 'msg-1',
          chips: [
            {
              callId: 'call-1',
              name: 'web_search',
              status: 'done',
              label: 'Searched "hacker news"',
              sources: [{ title: 'Hacker News', url: 'https://news.ycombinator.com' }],
            },
          ],
        },
      ]);
    });

    it('a fake that requests tools forever stops after MAX_TOOL_ROUNDS, and the final call carries no tools key', async () => {
      const conversationStore = new FakeConversationStore();
      const usageService = new FakeUsageService();
      const toolRuntime = new FakeToolRuntime();
      toolRuntime.results = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => ({
        status: 'done' as const,
        content: `result ${i}`,
        label: `Searched "q${i}"`,
        sources: [],
      }));

      let calls = 0;
      const toolsSeenPerCall: unknown[] = [];
      async function* stream(params: OpencodeChatCompletionParams): AsyncGenerator<OpencodeStreamChunk> {
        calls += 1;
        toolsSeenPerCall.push(params.tools);
        yield doneChunk('tool_calls', {
          toolCalls: [{ id: `call-${calls}`, name: 'web_search', arguments: `{"query":"q${calls}"}` }],
        });
      }

      const service = new ChatService(
        conversationStore,
        usageService,
        fakeOpencodeService(stream),
        toolRuntime,
      );
      const events: ChatEvent[] = [];
      await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

      // MAX_TOOL_ROUNDS calls offered tools; the round after that is sent
      // with no tools key at all, forcing an answer — model keeps
      // returning tool_calls anyway (a hostile/broken model), so the loop
      // stops there rather than looping forever.
      expect(calls).toBe(MAX_TOOL_ROUNDS + 1);
      expect(toolsSeenPerCall.slice(0, MAX_TOOL_ROUNDS).every((t) => t !== undefined)).toBe(true);
      expect(toolsSeenPerCall[MAX_TOOL_ROUNDS]).toBeUndefined();

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toEqual({ type: 'done', finishReason: 'tool_calls' });
    });

    it('a failing execute still yields an answer and no error event', async () => {
      const conversationStore = new FakeConversationStore();
      const usageService = new FakeUsageService();
      const toolRuntime = new FakeToolRuntime();
      toolRuntime.results = [
        {
          status: 'failed',
          content: 'Search failed: provider unreachable. Answer from your own knowledge and say the lookup failed.',
          label: 'Couldn\'t search "q"',
          sources: [],
        },
      ];

      let calls = 0;
      async function* stream(): AsyncGenerator<OpencodeStreamChunk> {
        calls += 1;
        if (calls === 1) {
          yield doneChunk('tool_calls', {
            toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{"query":"q"}' }],
          });
        } else {
          yield { type: 'delta', text: 'I could not search, but here is what I know.' };
          yield doneChunk('stop');
        }
      }

      const service = new ChatService(
        conversationStore,
        usageService,
        fakeOpencodeService(stream),
        toolRuntime,
      );
      const events: ChatEvent[] = [];
      await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

      expect(events.some((e) => e.type === 'error')).toBe(false);
      const toolDoneEvent = events.find(
        (e) => e.type === 'tool' && e.chip.status === 'failed',
      );
      expect(toolDoneEvent).toBeDefined();
      const doneEvent = events[events.length - 1];
      expect(doneEvent).toEqual({ type: 'done', finishReason: 'stop' });
    });

    it('abort mid-tool persists the partial message and the chips (running coerced to failed)', async () => {
      const conversationStore = new FakeConversationStore();
      const usageService = new FakeUsageService();
      const abortController = new AbortController();
      const toolRuntime: ToolRuntime = {
        definitions: () => TOOL_DEFINITIONS,
        execute: async () => {
          abortController.abort();
          return {
            status: 'done',
            content: 'result',
            label: 'Searched "q"',
            sources: [],
          };
        },
      };

      async function* stream(): AsyncGenerator<OpencodeStreamChunk> {
        yield { type: 'delta', text: 'partial' };
        yield doneChunk('tool_calls', {
          toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{"query":"q"}' }],
        });
      }

      const service = new ChatService(
        conversationStore,
        usageService,
        fakeOpencodeService(stream),
        toolRuntime,
      );
      const events: ChatEvent[] = [];
      await service.run('acct-1', body, (e) => events.push(e), abortController.signal);

      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(events.some((e) => e.type === 'done')).toBe(false);
      expect(conversationStore.finalizeCalls).toEqual([
        { assistantMessageId: 'msg-1', content: 'partial', aborted: true, cost: null },
      ]);
      // The running chip that was mid-flight when abort landed is still
      // saved (as 'running' — the store coerces it to 'failed', per
      // InMemoryConversationStore/PostgreSQL's saveToolCalls; the service
      // itself just passes along whatever chips exist).
      expect(conversationStore.saveToolCallsCalls[0].chips).toHaveLength(1);
      expect(conversationStore.saveToolCallsCalls[0].chips[0].callId).toBe('call-1');
    });

    it('a model not in TOOL_CAPABLE_MODELS streams normally with no tools param and no chips', async () => {
      process.env.TOOL_CAPABLE_MODELS = 'some-other-model';
      const conversationStore = new FakeConversationStore();
      const usageService = new FakeUsageService();
      const toolRuntime = new FakeToolRuntime();

      let seenTools: unknown = 'unset';
      async function* stream(params: OpencodeChatCompletionParams): AsyncGenerator<OpencodeStreamChunk> {
        seenTools = params.tools;
        yield { type: 'delta', text: 'hi' };
        yield doneChunk('stop');
      }

      const service = new ChatService(
        conversationStore,
        usageService,
        fakeOpencodeService(stream),
        toolRuntime,
      );
      const events: ChatEvent[] = [];
      await service.run('acct-1', body, (e) => events.push(e), new AbortController().signal);

      expect(seenTools).toBeUndefined();
      expect(events.some((e) => e.type === 'tool')).toBe(false);
      expect(toolRuntime.executeCalls).toEqual([]);
    });
  });
});
