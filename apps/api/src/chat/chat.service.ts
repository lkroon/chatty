import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatEvent, ChatRequest } from '@contracts/chat';
import type { UsageService } from '@contracts/usage-service';
import { CONVERSATION_STORE, ConversationStore } from './conversation-store';
import { USAGE_SERVICE } from './in-memory-usage-service';
import { OpencodeService } from '../opencode/opencode.service';
import { OpencodeUpstreamError } from '../opencode/opencode-client.types';

/**
 * Drives one POST /api/chat exchange, decoupled from Express so it can be
 * unit-tested without a real HTTP server. The controller owns writing
 * `emit`'s output onto the actual SSE response and tying `signal` to
 * `res.on('close')`.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CONVERSATION_STORE)
    private readonly conversationStore: ConversationStore,
    @Inject(USAGE_SERVICE) private readonly usageService: UsageService,
    private readonly opencodeService: OpencodeService,
  ) {}

  async run(
    accountId: string | undefined,
    body: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    // Auth is B's job (guard in front of this controller). This check is
    // only a safety net for Wave 1, where our own tests run with no
    // guard in front of them — missing accountId here shouldn't happen
    // once B's guard is wired, so it's treated as an upstream-class
    // failure rather than a crash.
    if (!accountId) {
      emit({
        type: 'error',
        code: 'UPSTREAM',
        message: 'Not authenticated',
      });
      return;
    }

    const usageResult = await this.usageService.consume(accountId);
    if (!usageResult.ok) {
      emit({
        type: 'error',
        code: 'LIMIT_EXCEEDED',
        message: 'Daily message limit reached',
      });
      return;
    }

    const { conversationId, assistantMessageId } =
      await this.conversationStore.startExchange({
        accountId,
        conversationId: body.conversationId,
        model: body.model,
        userContent: body.content,
      });

    emit({ type: 'meta', conversationId, messageId: assistantMessageId });

    let accumulated = '';
    let aborted = false;

    try {
      const history = await this.conversationStore.getHistory({
        accountId,
        conversationId,
        excludeMessageId: assistantMessageId,
      });

      for await (const chunk of this.opencodeService.streamChatCompletion({
        model: body.model,
        messages: history,
        signal,
      })) {
        if (signal.aborted) {
          aborted = true;
          break;
        }
        if (chunk.type === 'delta') {
          accumulated += chunk.text;
          emit({ type: 'delta', text: chunk.text });
        } else {
          emit({ type: 'done', finishReason: chunk.finishReason });
        }
      }
    } catch (err) {
      if (signal.aborted) {
        aborted = true;
      } else if (err instanceof OpencodeUpstreamError) {
        if (err.status === 429) {
          emit({
            type: 'error',
            code: 'RATE_LIMIT',
            message: 'Upstream rate limited',
          });
        } else if (err.status >= 500) {
          emit({
            type: 'error',
            code: 'UPSTREAM',
            message: `Upstream error ${err.status}`,
          });
        } else {
          emit({
            type: 'error',
            code: 'UPSTREAM',
            message: `Upstream returned status ${err.status}`,
          });
        }
      } else {
        this.logger.error('Unexpected error streaming from OpenCode', err as Error);
        emit({
          type: 'error',
          code: 'UPSTREAM',
          message: (err as Error)?.message ?? 'Unknown upstream error',
        });
      }
    } finally {
      await this.conversationStore.finalizeAssistantMessage({
        assistantMessageId,
        content: accumulated,
        aborted,
      });
    }
  }
}
