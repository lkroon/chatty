import { randomUUID } from 'node:crypto';
import { SseFrameParser } from './sse-frame-parser';
import {
  AccumulatedToolCall,
  OpencodeChatCompletionParams,
  OpencodeStreamChunk,
  OpencodeUpstreamError,
} from './opencode-client.types';

/** Upstream error bodies are short; this only guards against a stray HTML page. */
const MAX_ERROR_BODY_CHARS = 500;

/** One streamed tool-call fragment, keyed by `index`, before reassembly. */
interface ToolCallFragment {
  index: number;
  id?: string;
  name?: string;
  argumentsFragment?: string;
}

/** Everything one raw SSE frame can carry, extracted in one pass. */
interface ParsedFrame {
  literalDone: boolean;
  finishReason?: string;
  deltaText?: string;
  reasoning: boolean;
  /**
   * Every entry of this frame's `delta.tool_calls`, not just the first.
   * An upstream is free to batch several parallel calls into one frame,
   * or to repeat already-seen entries cumulatively — reading only [0]
   * silently loses calls 2..n.
   */
  toolCallFragments?: ToolCallFragment[];
  /** Raw string form of a `cost` field, if this frame carried one. */
  cost?: string;
}

/**
 * Thin client for the OpenCode Go subscription's upstream chat-completion
 * API. Uses Node 22's global `fetch` — no third-party HTTP client.
 *
 * Verified against the live API on 2026-09-02 (see the Wave 1.5 plan):
 * `OPENCODE_BASE_URL` defaults to `https://opencode.ai/zen/go/v1`;
 * `POST /chat/completions` is OpenAI-compatible chat-completions streaming,
 * and additionally accepts a top-level `tools` array in OpenAI
 * function-calling format. Since 2026-09 it also *requires* an
 * `x-opencode-session` header — every request without one is rejected 400
 * `MissingSessionID`, whatever the model or payload. A completion signals its end **twice** — a
 * `finish_reason` frame, then a separate `data: [DONE]` frame — and a
 * trailing `{"choices":[],"cost":"…"}` frame can arrive **after**
 * `[DONE]`. This client reads the whole response body before yielding its
 * one `done` chunk so that trailing frame is never lost; `delta`/`reasoning`
 * chunks are still yielded the moment their frame arrives, so the stream is
 * progressive all the way up to that point.
 *
 * Tool calls stream as fragments keyed by `index` (`delta.tool_calls[]`);
 * reassembly by index happens entirely inside this client — a consumer
 * only ever sees the fully reassembled calls, attached to the `done` chunk.
 * The framing is treated as advisory rather than fixed, because it is not
 * one shape in practice: a frame may carry several `tool_calls` entries at
 * once, may repeat entries it already sent, may deliver them in the same
 * frame as `finish_reason`, and may hand back `function.arguments` already
 * parsed into an object instead of as a JSON string fragment. Every one of
 * those was silently lossy until 2026-09-16 and surfaced to the user as a
 * tool that "failed repeatedly" for no visible reason.
 *
 * Behind a narrow class interface deliberately: leaves room for a second
 * transport later without callers caring, but only fetch-based streaming
 * is implemented.
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
        'x-opencode-session': params.sessionId,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      // Read the body before throwing: it is the only place the upstream
      // says *why*, and the response is discarded a line later.
      const body = await OpencodeClient.readErrorBody(response);
      throw new OpencodeUpstreamError(
        response.status,
        `OpenCode upstream responded ${response.status}`,
        body,
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

    // Round-level accumulators. `finishReason`/`cost` use "first/last frame
    // wins" — see the class doc comment on why we keep reading past the
    // first end-of-stream signal instead of stopping there.
    let finishReason: string | null = null;
    let costRaw: string | undefined;
    const toolCallFragments = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();

    const handleFrame = function* (
      raw: string,
    ): Generator<OpencodeStreamChunk> {
      const parsed = OpencodeClient.parseFrame(raw);
      if (!parsed) {
        return;
      }
      if (parsed.cost !== undefined) {
        costRaw = parsed.cost;
      }
      if (parsed.literalDone) {
        finishReason ??= 'stop';
        return;
      }
      // A frame's payload is accumulated BEFORE its `finish_reason` is
      // recorded, and recording one no longer ends the frame: some
      // upstreams deliver the whole `tool_calls` array in the very frame
      // that carries `finish_reason: 'tool_calls'`, and returning early
      // there dropped every call in the round.
      for (const frag of parsed.toolCallFragments ?? []) {
        const existing = toolCallFragments.get(frag.index) ?? { args: '' };
        if (frag.id) {
          existing.id = frag.id;
        }
        if (frag.name) {
          existing.name = frag.name;
        }
        if (frag.argumentsFragment) {
          existing.args += frag.argumentsFragment;
        }
        toolCallFragments.set(frag.index, existing);
      }
      if (parsed.reasoning) {
        yield { type: 'reasoning' };
      } else if (parsed.deltaText) {
        yield { type: 'delta', text: parsed.deltaText };
      }
      if (parsed.finishReason) {
        finishReason ??= parsed.finishReason;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const text = decoder.decode(value, { stream: true });
        for (const frame of parser.push(text)) {
          yield* handleFrame(frame.data);
        }
      }
      // A well-behaved stream ends on a `\n\n` boundary, so this drains
      // nothing extra in the normal case — it only matters for a server
      // that omits the final blank line.
      for (const frame of parser.flush()) {
        yield* handleFrame(frame.data);
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls =
      OpencodeClient.buildAccumulatedToolCalls(toolCallFragments);
    const cost =
      costRaw === undefined ? null : OpencodeClient.parseCost(costRaw);
    yield {
      type: 'done',
      finishReason: finishReason ?? 'stop',
      toolCalls,
      cost,
    };
  }

  private static async readErrorBody(
    response: Response,
  ): Promise<string | undefined> {
    try {
      const text = await response.text();
      return text.length > MAX_ERROR_BODY_CHARS
        ? `${text.slice(0, MAX_ERROR_BODY_CHARS)}…`
        : text;
    } catch {
      return undefined;
    }
  }

  private static parseCost(raw: string): number | null {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  private static buildAccumulatedToolCalls(
    fragments: Map<number, { id?: string; name?: string; args: string }>,
  ): AccumulatedToolCall[] | undefined {
    if (fragments.size === 0) {
      return undefined;
    }
    return [...fragments.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        // An upstream that omits ids used to hand every call the same `''`,
        // which collapses the chips keyed on it and sends a meaningless
        // `tool_call_id` back up. The id only has to be unique within the
        // exchange; nothing upstream can match on it if it never sent one.
        id: call.id ?? `synthetic-${randomUUID()}`,
        name: call.name ?? '',
        arguments: call.args,
      }));
  }

  private static parseFrame(data: string): ParsedFrame | null {
    if (data === '[DONE]') {
      return { literalDone: true, reasoning: false };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // Malformed frame from upstream — skip it rather than aborting an
      // otherwise-good stream.
      return null;
    }
    const body = parsed as { choices?: unknown[]; cost?: unknown };
    const result: ParsedFrame = { literalDone: false, reasoning: false };
    if (typeof body.cost === 'string' || typeof body.cost === 'number') {
      result.cost = String(body.cost);
    }

    const choice = body.choices?.[0] as
      | {
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: unknown[];
          };
          finish_reason?: string | null;
        }
      | undefined;
    if (!choice) {
      return result;
    }
    if (choice.finish_reason) {
      result.finishReason = choice.finish_reason;
      // Deliberately NOT returning here — the same frame may still carry
      // the delta this round's tool calls live in.
    }

    const delta = choice.delta;
    const toolCalls = delta?.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const fragments = toolCalls
        .map((entry, position) =>
          OpencodeClient.parseToolCallEntry(entry, position),
        )
        .filter((fragment): fragment is ToolCallFragment => fragment !== null);
      if (fragments.length > 0) {
        result.toolCallFragments = fragments;
      }
      return result;
    }

    if (
      typeof delta?.reasoning_content === 'string' &&
      delta.reasoning_content.length > 0
    ) {
      result.reasoning = true;
      return result;
    }
    const text = delta?.content;
    if (typeof text === 'string' && text.length > 0) {
      result.deltaText = text;
    }
    return result;
  }

  /**
   * One `delta.tool_calls[]` entry. `position` is the fallback key for an
   * upstream that omits `index` on a single-call frame; when several calls
   * are batched into one frame their array order is the only ordering there
   * is, so it doubles as the index.
   */
  private static parseToolCallEntry(
    entry: unknown,
    position: number,
  ): ToolCallFragment | null {
    const tc = entry as
      | {
          index?: number;
          id?: string;
          function?: { name?: unknown; arguments?: unknown };
        }
      | undefined;
    if (!tc || typeof tc !== 'object') {
      return null;
    }
    const rawArguments = tc.function?.arguments;
    return {
      index: typeof tc.index === 'number' ? tc.index : position,
      id: typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : undefined,
      name:
        typeof tc.function?.name === 'string' ? tc.function.name : undefined,
      // Normally a string fragment of a JSON document, concatenated across
      // frames. An upstream that hands back an already-parsed object instead
      // is re-serialized rather than dropped — dropping it left `arguments`
      // as `''`, which fails JSON.parse and surfaces as "Couldn't run
      // web_fetch" for every call in the round.
      argumentsFragment:
        typeof rawArguments === 'string'
          ? rawArguments
          : rawArguments !== undefined && rawArguments !== null
            ? JSON.stringify(rawArguments)
            : undefined,
    };
  }
}
