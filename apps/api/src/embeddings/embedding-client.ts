/**
 * Thin transport for an OpenAI-compatible `/embeddings` endpoint (Feature B).
 * Deliberately knows nothing about env vars or the app: the caller passes
 * base URL and key, this module owns only the wire shapes and error mapping.
 *
 * The provider is Google AI Studio's OpenAI-compatible endpoint by default
 * (see EMBEDDING_BASE_URL in .env.example), but any OpenAI-compatible
 * provider works — swapping is an env change, not a code change.
 */

export interface EmbeddingRequest {
  model: string;
  input: string[];
  /** Gemini's OpenAI-compat name for output_dimensionality. */
  dimensions: number;
}

export interface EmbeddingResponse {
  data: { embedding: number[] }[];
}

/** The provider answered, but not with 200 — status and body are the only clues. */
export class EmbeddingUpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`embedding provider returned status ${status}`);
    this.name = 'EmbeddingUpstreamError';
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export class EmbeddingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async embed(request: EmbeddingRequest): Promise<number[][]> {
    // Network errors propagate unwrapped: the callers that log them
    // (best-effort write path, backfill) already say what they were doing.
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      // Fire-and-forget callers must not hang on a stuck provider.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body = await response.text();
    if (!response.ok) {
      throw new EmbeddingUpstreamError(response.status, body);
    }

    let parsed: EmbeddingResponse;
    try {
      parsed = JSON.parse(body) as EmbeddingResponse;
    } catch {
      throw new Error('embedding provider returned invalid JSON');
    }

    const vectors = parsed.data?.map((entry) => entry.embedding);
    if (
      !Array.isArray(vectors) ||
      vectors.length !== request.input.length ||
      vectors.some((vector) => !Array.isArray(vector))
    ) {
      // One vector per input text, in input order — anything else is a
      // provider contract break, and silently misaligned rows would be
      // far worse than a failed batch.
      throw new Error('embedding provider returned a mismatched response');
    }
    return vectors;
  }
}
