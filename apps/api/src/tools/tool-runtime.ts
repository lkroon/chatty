import type { ToolName, ToolSource } from '@contracts/chat';
import type { ProposalCard } from '@contracts/proposal';
import type { ToolBudget } from './tool-budget';

export interface ToolDefinition {
  type: 'function';
  function: { name: ToolName; description: string; parameters: object };
}

export interface ToolExecutionResult {
  /** Exactly what goes back to the model as the `tool` message content. Already truncated. */
  content: string;
  /** Human line for the chip. */
  label: string;
  sources: ToolSource[];
  status: 'done' | 'failed';
  /**
   * Set only by the three write tools. Its presence is also what tells
   * `execute` not to wrap the content in the untrusted-web-content frame —
   * this text is ours, not a stranger's.
   */
  proposal?: ProposalCard;
}

/**
 * Who this exchange belongs to. `web_search` does not care; a proposal does —
 * it is written against exactly this account, and can be confirmed by nobody
 * else. Passed per call rather than held on the runtime because TOOL_RUNTIME
 * is a process-wide singleton shared by every request.
 */
export interface ToolActor {
  accountId: number;
  conversationId: string;
}

/**
 * Tool execution seam — no Nest request scope, no knowledge that SSE exists.
 * The only state it may reach is a `proposals` row for `actor.accountId`,
 * written through the narrow ProposalToolPort; nothing here can call Google.
 * `execute` never throws: every failure path (unknown tool name, unparseable
 * arguments, provider down, timeout, blocked URL, budget exhausted) returns
 * `status: 'failed'` with a `content` string the model can read and route
 * around. A thrown error out of an implementation is a bug — callers log it
 * and convert it to the same shape rather than failing the exchange.
 */
export interface ToolRuntime {
  /** The `tools` array sent upstream. Stable across a process's lifetime. */
  definitions(): ToolDefinition[];
  execute(
    call: { name: string; rawArguments: string },
    budget: ToolBudget,
    signal: AbortSignal,
    actor: ToolActor,
  ): Promise<ToolExecutionResult>;
}

export const TOOL_RUNTIME = 'TOOL_RUNTIME';
