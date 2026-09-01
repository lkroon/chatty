export interface OpencodeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpencodeChatCompletionParams {
  model: string;
  messages: OpencodeMessage[];
  signal?: AbortSignal;
}

/**
 * One piece of a streamed completion, already normalized away from the
 * OpenCode upstream's raw SSE JSON shape.
 */
export type OpencodeStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason: string };

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
