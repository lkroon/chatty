import type { ToolDefinition } from '../tools/tool-runtime';

export interface OpencodeToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpencodeMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Assistant messages that requested tools echo these back verbatim on the next round. */
  tool_calls?: OpencodeToolCall[];
  /** Set on a `role: 'tool'` message — the id of the call this message answers. */
  tool_call_id?: string;
}

export interface OpencodeChatCompletionParams {
  model: string;
  messages: OpencodeMessage[];
  /** Omitted entirely (not sent as an empty array) when tools shouldn't be offered this round. */
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

/** One tool call, fully reassembled from its streamed `index`-keyed fragments. */
export interface AccumulatedToolCall {
  id: string;
  name: string;
  /** Concatenated raw JSON string. Only safe to `JSON.parse` once the round ends. */
  arguments: string;
}

/**
 * One piece of a streamed completion, already normalized away from the
 * OpenCode upstream's raw SSE JSON shape. Tool-call fragments and the
 * upstream's double end-of-stream signal (a `finish_reason` frame *and* a
 * later `[DONE]`) are reassembled internally by `OpencodeClient` — a
 * consumer only ever sees `delta`, `reasoning` and exactly one `done` per
 * round, and `done` carries whatever tool calls and cost were captured.
 */
export type OpencodeStreamChunk =
  | { type: 'delta'; text: string }
  /**
   * The model's chain of thought is streaming (`delta.reasoning_content`
   * upstream). Carries no text — the reasoning itself is never surfaced
   * beyond this signal.
   */
  | { type: 'reasoning' }
  | {
      type: 'done';
      finishReason: string;
      toolCalls?: AccumulatedToolCall[];
      /** `Number(cost)` from the trailing upstream frame, or `null` when absent/unparseable. */
      cost: number | null;
    };

/** Thrown by OpencodeClient for any non-2xx response from the upstream. */
export class OpencodeUpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpencodeUpstreamError';
  }
}
