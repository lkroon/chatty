import type { ToolName, ToolSource } from '@contracts/chat';
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
}

/**
 * Pure tool execution seam — no Nest request scope, no database, no
 * knowledge that SSE exists. `execute` never throws: every failure path
 * (unknown tool name, unparseable arguments, provider down, timeout,
 * blocked URL, budget exhausted) returns `status: 'failed'` with a
 * `content` string the model can read and route around. A thrown error
 * out of an implementation is a bug — callers log it and convert it to
 * the same shape rather than failing the exchange.
 */
export interface ToolRuntime {
  /** The `tools` array sent upstream. Stable across a process's lifetime. */
  definitions(): ToolDefinition[];
  execute(
    call: { name: string; rawArguments: string },
    budget: ToolBudget,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult>;
}

export const TOOL_RUNTIME = 'TOOL_RUNTIME';
