import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatEvent, ChatRequest, ToolCallChip, ToolName } from '@contracts/chat';
import type { UsageService } from '@contracts/usage-service';
import { CONVERSATION_STORE, ConversationStore } from './conversation-store';
import { USAGE_SERVICE } from './in-memory-usage-service';
import { isToolCapableModel } from './tool-capable-models';
import { OpencodeService } from '../opencode/opencode.service';
import { OpencodeUpstreamError } from '../opencode/opencode-client.types';
import type { OpencodeMessage } from '../opencode/opencode-client.types';
import { TOOL_RUNTIME, ToolRuntime } from '../tools/tool-runtime';
import { MAX_TOOL_ROUNDS, ToolBudget } from '../tools/tool-budget';

/** `Searching…` / `Reading…` — the real label arrives with the result. */
function provisionalLabel(name: string): string {
  if (name === 'web_search') {
    return 'Searching…';
  }
  if (name === 'web_fetch') {
    return 'Reading…';
  }
  return 'Working…';
}

/**
 * Wave 1.5: web search/fetch are model-driven tools, only offered when
 * WEB_SEARCH_ENABLED and the model is in TOOL_CAPABLE_MODELS. When tools
 * aren't offered this exchange, the prompt is just the first sentence.
 */
function buildSystemPrompt(toolsOffered: boolean): string {
  const today = new Date().toISOString().slice(0, 10);
  const base = `You are a helpful assistant in a personal chat app. Today's date is ${today}.`;
  if (!toolsOffered) {
    return base;
  }
  return (
    `${base}\n` +
    'You can search the web and fetch pages. Use web_search when the answer depends on\n' +
    'current events, prices, releases, versions, or anything you are unsure is still\n' +
    'true. Use web_fetch only on URLs the user gave you or that web_search returned —\n' +
    'never on a URL you guessed. Prefer one search and at most one or two fetches.\n' +
    'Cite the sources you actually used as inline markdown links. If the tools fail or\n' +
    'return nothing useful, say so plainly instead of guessing.'
  );
}

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
    @Inject(TOOL_RUNTIME) private readonly toolRuntime: ToolRuntime,
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
    const chips: ToolCallChip[] = [];
    let totalCost: number | null = null;

    const toolsOffered = isToolCapableModel(body.model);

    try {
      const history = await this.conversationStore.getHistory({
        accountId,
        conversationId,
        excludeMessageId: assistantMessageId,
      });

      const messages: OpencodeMessage[] = [
        { role: 'system', content: buildSystemPrompt(toolsOffered) },
        ...history.map((h) => ({ role: h.role, content: h.content })),
      ];

      const budget = new ToolBudget();
      let rounds = 0;

      while (true) {
        if (signal.aborted) {
          aborted = true;
          break;
        }

        const sendTools = toolsOffered && rounds < MAX_TOOL_ROUNDS;
        let roundText = '';
        let emittedThinking = false;
        let finishReason: string | null = null;
        let toolCalls: { id: string; name: string; arguments: string }[] = [];

        for await (const chunk of this.opencodeService.streamChatCompletion({
          model: body.model,
          messages,
          tools: sendTools ? this.toolRuntime.definitions() : undefined,
          signal,
        })) {
          if (signal.aborted) {
            aborted = true;
            break;
          }
          if (chunk.type === 'delta') {
            roundText += chunk.text;
            accumulated += chunk.text;
            emit({ type: 'delta', text: chunk.text });
          } else if (chunk.type === 'reasoning') {
            if (!emittedThinking) {
              emit({ type: 'thinking' });
              emittedThinking = true;
            }
          } else {
            finishReason = chunk.finishReason;
            toolCalls = chunk.toolCalls ?? [];
            if (chunk.cost !== null) {
              totalCost = (totalCost ?? 0) + chunk.cost;
            }
          }
        }

        if (aborted) {
          break;
        }

        // `!sendTools` forces this round terminal regardless of what the
        // upstream claims: round MAX_TOOL_ROUNDS + 1 was sent with no
        // `tools` key, so a `finish_reason: 'tool_calls'` here can only be
        // a broken or hostile upstream, never a legitimate call — trusting
        // it would loop forever past the budget this check exists for.
        if (!sendTools || finishReason !== 'tool_calls' || toolCalls.length === 0) {
          emit({ type: 'done', finishReason: finishReason ?? 'stop' });
          break;
        }

        rounds += 1;
        messages.push({
          role: 'assistant',
          content: roundText,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        });

        for (const call of toolCalls) {
          if (signal.aborted) {
            aborted = true;
            break;
          }
          const runningChip: ToolCallChip = {
            callId: call.id,
            name: call.name as ToolName,
            status: 'running',
            label: provisionalLabel(call.name),
            sources: [],
          };
          chips.push(runningChip);
          emit({ type: 'tool', chip: runningChip });

          const result = await this.toolRuntime.execute(
            { name: call.name, rawArguments: call.arguments },
            budget,
            signal,
          );

          const finishedChip: ToolCallChip = {
            ...runningChip,
            status: result.status,
            label: result.label,
            sources: result.sources,
          };
          const index = chips.findIndex((c) => c.callId === call.id);
          chips[index] = finishedChip;
          emit({ type: 'tool', chip: finishedChip });

          messages.push({ role: 'tool', content: result.content, tool_call_id: call.id });
        }

        if (aborted) {
          break;
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
        cost: totalCost,
      });
      // Running chips left over from an abort mid-tool-call are coerced to
      // 'failed' by the store — a running chip means the process died
      // mid-call. Runs unconditionally, including with an empty array.
      await this.conversationStore.saveToolCalls({ assistantMessageId, chips });
    }
  }
}
