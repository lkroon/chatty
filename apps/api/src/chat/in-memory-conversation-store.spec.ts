import { InMemoryConversationStore } from './in-memory-conversation-store';

describe('InMemoryConversationStore', () => {
  it('creates a new conversation with a title truncated to 60 chars when conversationId is omitted', async () => {
    const store = new InMemoryConversationStore();
    const longContent = 'x'.repeat(100);

    const result = await store.startExchange({
      accountId: 'acct-1',
      model: 'glm-5.3',
      userContent: longContent,
    });

    expect(result.conversationId).toBeTruthy();
    expect(result.assistantMessageId).toBeTruthy();

    const conversation = store.getConversation(result.conversationId);
    expect(conversation?.title).toBe('x'.repeat(60));
    expect(conversation?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: longContent }),
      expect.objectContaining({
        id: result.assistantMessageId,
        role: 'assistant',
        content: '',
        finishReason: null,
      }),
    ]);
  });

  it('appends to an existing conversation when conversationId is given', async () => {
    const store = new InMemoryConversationStore();
    const first = await store.startExchange({
      accountId: 'acct-1',
      model: 'glm-5.3',
      userContent: 'first message',
    });

    const second = await store.startExchange({
      accountId: 'acct-1',
      conversationId: first.conversationId,
      model: 'glm-5.3',
      userContent: 'second message',
    });

    expect(second.conversationId).toBe(first.conversationId);
    const conversation = store.getConversation(first.conversationId);
    expect(conversation?.messages).toHaveLength(4);
    expect(conversation?.messages[2]).toEqual(
      expect.objectContaining({ role: 'user', content: 'second message' }),
    );
  });

  it('finalizeAssistantMessage sets content and finish_reason=aborted on abort', async () => {
    const store = new InMemoryConversationStore();
    const { conversationId, assistantMessageId } = await store.startExchange({
      accountId: 'acct-1',
      model: 'glm-5.3',
      userContent: 'hi',
    });

    await store.finalizeAssistantMessage({
      assistantMessageId,
      content: 'partial reply',
      aborted: true,
    });

    const message = store
      .getConversation(conversationId)
      ?.messages.find((m) => m.id === assistantMessageId);
    expect(message).toEqual({
      id: assistantMessageId,
      role: 'assistant',
      content: 'partial reply',
      finishReason: 'aborted',
      cost: null,
    });
  });

  it('finalizeAssistantMessage sets finish_reason=null on normal completion', async () => {
    const store = new InMemoryConversationStore();
    const { conversationId, assistantMessageId } = await store.startExchange({
      accountId: 'acct-1',
      model: 'glm-5.3',
      userContent: 'hi',
    });

    await store.finalizeAssistantMessage({
      assistantMessageId,
      content: 'full reply',
      aborted: false,
    });

    const message = store
      .getConversation(conversationId)
      ?.messages.find((m) => m.id === assistantMessageId);
    expect(message?.finishReason).toBeNull();
  });

  it('saveToolCalls stores the chips, coercing a running status to failed', async () => {
    const store = new InMemoryConversationStore();
    const { conversationId, assistantMessageId } = await store.startExchange({
      accountId: 'acct-1',
      model: 'glm-5.3',
      userContent: 'hi',
    });

    await store.saveToolCalls({
      assistantMessageId,
      chips: [
        {
          callId: 'call-1',
          name: 'web_search',
          status: 'running',
          label: 'Searching…',
          sources: [],
        },
      ],
    });

    const message = store
      .getConversation(conversationId)
      ?.messages.find((m) => m.id === assistantMessageId);
    expect(message?.toolCalls).toEqual([
      { callId: 'call-1', name: 'web_search', status: 'failed', label: 'Searching…', sources: [] },
    ]);
  });

  it('saveToolCalls tolerates an empty array (no-op)', async () => {
    const store = new InMemoryConversationStore();
    const { assistantMessageId } = await store.startExchange({
      accountId: 'acct-1',
      model: 'glm-5.3',
      userContent: 'hi',
    });
    await expect(store.saveToolCalls({ assistantMessageId, chips: [] })).resolves.toBeUndefined();
  });
});
