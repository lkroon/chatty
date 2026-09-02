import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ToolCallChip } from '@contracts/chat';
import { ConversationStore } from './conversation-store';

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  finishReason: string | null;
  cost?: number | null;
  toolCalls?: ToolCallChip[];
}

interface StoredConversation {
  id: string;
  accountId: string;
  title: string;
  model: string;
  messages: StoredMessage[];
}

const TITLE_MAX_LEN = 60;

/**
 * Wave 1 fake for ConversationStore — a Map-backed store, good enough for
 * workstream A's own tests. Wave 2 swaps the CONVERSATION_STORE provider
 * in ChatModule for workstream C's real Postgres-backed implementation
 * (apps/api/src/conversations/**, see conversation-store.ts).
 */
@Injectable()
export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, StoredConversation>();

  async startExchange(input: {
    accountId: string;
    conversationId?: string;
    model: string;
    userContent: string;
  }): Promise<{ conversationId: string; assistantMessageId: string }> {
    let conversation = input.conversationId
      ? this.conversations.get(input.conversationId)
      : undefined;

    if (!conversation) {
      conversation = {
        id: input.conversationId ?? randomUUID(),
        accountId: input.accountId,
        title: input.userContent.slice(0, TITLE_MAX_LEN),
        model: input.model,
        messages: [],
      };
      this.conversations.set(conversation.id, conversation);
    }

    conversation.messages.push({
      id: randomUUID(),
      role: 'user',
      content: input.userContent,
      finishReason: null,
    });

    const assistantMessageId = randomUUID();
    conversation.messages.push({
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      finishReason: null,
    });

    return { conversationId: conversation.id, assistantMessageId };
  }

  async getHistory(input: {
    accountId: string;
    conversationId: string;
    excludeMessageId: string;
  }) {
    const conversation = this.conversations.get(input.conversationId);
    if (!conversation || conversation.accountId !== input.accountId) {
      throw new Error('conversation not found');
    }
    return conversation.messages
      .filter((message) => message.id !== input.excludeMessageId)
      .map(({ role, content }) => ({ role, content }));
  }

  async finalizeAssistantMessage(input: {
    assistantMessageId: string;
    content: string;
    aborted: boolean;
    cost?: number | null;
  }): Promise<void> {
    for (const conversation of this.conversations.values()) {
      const message = conversation.messages.find(
        (m) => m.id === input.assistantMessageId,
      );
      if (message) {
        message.content = input.content;
        message.finishReason = input.aborted ? 'aborted' : null;
        message.cost = input.cost ?? null;
        return;
      }
    }
  }

  async saveToolCalls(input: {
    assistantMessageId: string;
    chips: ToolCallChip[];
  }): Promise<void> {
    if (input.chips.length === 0) {
      return;
    }
    for (const conversation of this.conversations.values()) {
      const message = conversation.messages.find(
        (m) => m.id === input.assistantMessageId,
      );
      if (message) {
        message.toolCalls = input.chips.map((chip) =>
          chip.status === 'running' ? { ...chip, status: 'failed' as const } : chip,
        );
        return;
      }
    }
  }

  /** Test/debug helper — not part of the ConversationStore interface. */
  getConversation(conversationId: string): StoredConversation | undefined {
    return this.conversations.get(conversationId);
  }
}
