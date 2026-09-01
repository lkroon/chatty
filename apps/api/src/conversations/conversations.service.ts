import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import type {
  ConversationDetail,
  ConversationListItem,
  Message,
} from '@contracts/conversation';
import { conversations, messages } from '../db/schema';
import { DB, type Db } from '../db/tokens';
import type {
  ConversationHistoryMessage,
  ConversationStore,
} from '../chat/conversation-store';

export interface StartExchangeInput {
  accountId: string;
  conversationId?: string;
  model: string;
  userContent: string;
}

export interface StartExchangeResult {
  conversationId: string;
  assistantMessageId: string;
}

export interface FinalizeAssistantMessageInput {
  assistantMessageId: string;
  content: string;
  aborted: boolean;
}

const TITLE_MAX_LEN = 60;

// Backs two seams:
//
//  1. This module's own controller: GET /api/conversations,
//     GET /api/conversations/:id, DELETE /api/conversations/:id.
//
//  2. `startExchange`, `getHistory`, and `finalizeAssistantMessage` implement
//     the ConversationStore seam consumed by ChatService. The module binds
//     this service to that token with `useExisting`.
@Injectable()
export class ConversationsService implements ConversationStore {
  constructor(@Inject(DB) private readonly db: Db) {}

  async startExchange(
    input: StartExchangeInput,
  ): Promise<StartExchangeResult> {
    const { accountId, model, userContent } = input;
    const accountIdNum = Number(accountId);

    let conversationId = input.conversationId;
    if (conversationId) {
      const [existing] = await this.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.accountId, accountIdNum),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new NotFoundException('conversation not found');
      }
    } else {
      const [created] = await this.db
        .insert(conversations)
        .values({
          accountId: accountIdNum,
          title: userContent.slice(0, TITLE_MAX_LEN),
          model,
        })
        .returning({ id: conversations.id });
      conversationId = created.id;
    }

    await this.db.insert(messages).values({
      conversationId,
      role: 'user',
      content: userContent,
      model,
    });

    const [assistantPlaceholder] = await this.db
      .insert(messages)
      .values({
        conversationId,
        role: 'assistant',
        content: '',
        model,
        finishReason: null,
      })
      .returning({ id: messages.id });

    await this.db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    return {
      conversationId,
      assistantMessageId: assistantPlaceholder.id,
    };
  }

  async finalizeAssistantMessage(
    input: FinalizeAssistantMessageInput,
  ): Promise<void> {
    const { assistantMessageId, content, aborted } = input;
    const [row] = await this.db
      .update(messages)
      .set({
        content,
        finishReason: aborted ? 'aborted' : null,
      })
      .where(eq(messages.id, assistantMessageId))
      .returning({ conversationId: messages.conversationId });

    if (row?.conversationId) {
      await this.db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, row.conversationId));
    }
  }

  async getHistory(input: {
    accountId: string;
    conversationId: string;
    excludeMessageId: string;
  }): Promise<ConversationHistoryMessage[]> {
    const [conversation] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.accountId, Number(input.accountId)),
        ),
      )
      .limit(1);

    if (!conversation) {
      throw new NotFoundException('conversation not found');
    }

    const rows = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          ne(messages.id, input.excludeMessageId),
        ),
      )
      .orderBy(messages.createdAt);

    return rows.map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content ?? '',
    }));
  }

  async listForAccount(accountId: string): Promise<ConversationListItem[]> {
    const rows = await this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.accountId, Number(accountId)))
      .orderBy(desc(conversations.updatedAt));

    return rows.map((row) => ({
      id: row.id,
      title: row.title ?? '',
      updatedAt: (row.updatedAt ?? new Date()).toISOString(),
    }));
  }

  async getDetailForAccount(
    accountId: string,
    conversationId: string,
  ): Promise<ConversationDetail> {
    const [conversation] = await this.db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.accountId, Number(accountId)),
        ),
      )
      .limit(1);

    if (!conversation) {
      // 404 for both "doesn't exist" and "belongs to another account" —
      // never distinguish, to avoid leaking existence across accounts.
      throw new NotFoundException('conversation not found');
    }

    const rows = await this.db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        finishReason: messages.finishReason,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    const msgs: Message[] = rows.map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant',
      content: row.content ?? '',
      createdAt: (row.createdAt ?? new Date()).toISOString(),
      finishReason: row.finishReason,
    }));

    return {
      id: conversation.id,
      title: conversation.title ?? '',
      messages: msgs,
    };
  }

  async deleteForAccount(
    accountId: string,
    conversationId: string,
  ): Promise<void> {
    const deleted = await this.db
      .delete(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.accountId, Number(accountId)),
        ),
      )
      .returning({ id: conversations.id });

    if (deleted.length === 0) {
      throw new NotFoundException('conversation not found');
    }
  }
}
