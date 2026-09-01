import { SseFrameParser } from './sse-frame-parser';
import {
  OpencodeChatCompletionParams,
  OpencodeStreamChunk,
  OpencodeUpstreamError,
} from './opencode-client.types';

/**
 * Thin client for the OpenCode Go subscription's upstream chat-completion
 * API. Uses Node 22's global `fetch` — no third-party HTTP client.
 *
 * UNVERIFIED SHAPE: `OPENCODE_BASE_URL` (plan default:
 * `https://opencode.ai/zen/go/v1`) and the `/chat/completions` request
 * body/response shape below are documented-but-unconfirmed per the Wave 1
 * plan — no live OpenCode credentials were available while building this,
 * so live verification against the real API is still required before
 * this ships. The assumed shape (OpenAI-compatible chat completions
 * streaming): POST body `{ model, messages, stream: true }`; upstream
 * responds `text/event-stream` with frames `data: <json>` where
 * `<json>.choices[0].delta.content` carries incremental text and
 * `<json>.choices[0].finish_reason` (non-null on the final content chunk)
 * signals completion, terminated by a literal `data: [DONE]` frame. If
 * the real API differs, only `parseFrameData()` below and the request
 * body in `streamChatCompletion()` should need to change — the transport
 * (fetch + SSE framing) stays the same.
 *
 * Behind a narrow class interface deliberately: leaves room for a second
 * transport later without callers caring, but only fetch-based streaming
 * is implemented for Wave 1.
 */
export class OpencodeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async *streamChatCompletion(
    params: OpencodeChatCompletionParams,
  ): AsyncGenerator<OpencodeStreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      throw new OpencodeUpstreamError(
        response.status,
        `OpenCode upstream responded ${response.status}`,
      );
    }
    if (!response.body) {
      throw new OpencodeUpstreamError(
        response.status,
        'OpenCode upstream returned no response body',
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseFrameParser();
    let sawDone = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const text = decoder.decode(value, { stream: true });
        for (const frame of parser.push(text)) {
          const chunk = OpencodeClient.parseFrameData(frame.data);
          if (chunk) {
            if (chunk.type === 'done') {
              sawDone = true;
            }
            yield chunk;
          }
        }
      }
      if (!sawDone) {
        // Stream ended without a trailing blank line after the last
        // frame, or without an explicit [DONE]/finish_reason — drain
        // whatever is left buffered.
        for (const frame of parser.flush()) {
          const chunk = OpencodeClient.parseFrameData(frame.data);
          if (chunk) {
            yield chunk;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private static parseFrameData(data: string): OpencodeStreamChunk | null {
    if (data === '[DONE]') {
      return { type: 'done', finishReason: 'stop' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // Malformed frame from upstream — skip it rather than aborting an
      // otherwise-good stream (UNVERIFIED shape, see class doc comment).
      return null;
    }
    const choice = (parsed as { choices?: unknown[] })?.choices?.[0] as
      | { delta?: { content?: string }; finish_reason?: string | null }
      | undefined;
    if (!choice) {
      return null;
    }
    if (choice.finish_reason) {
      return { type: 'done', finishReason: choice.finish_reason };
    }
    const text = choice.delta?.content;
    if (typeof text === 'string' && text.length > 0) {
      return { type: 'delta', text };
    }
    return null;
  }
}
