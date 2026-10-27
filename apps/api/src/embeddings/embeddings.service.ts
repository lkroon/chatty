import { Injectable } from '@nestjs/common';
import { EmbeddingClient } from './embedding-client';

/**
 * The seam the rest of the app embeds text through. A hand-rolled fake in
 * tests (one-hot vectors) makes ranking assertions deterministic with no
 * network; the real binding is EmbeddingsService below.
 */
export const EMBEDDER = Symbol('EMBEDDER');

export interface Embedder {
  /** False when the EMBEDDING_* env is incomplete: writers skip, search refuses. */
  readonly enabled: boolean;
  /** The embedding model id, stored per row so a future backfill can tell them apart. */
  readonly model: string;
  embedText(text: string): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
}

// gemini-embedding-001's input limit is 2048 tokens; ~4 chars/token makes
// 4000 chars a safe ceiling. Longer content is truncated, not rejected —
// an embedding of the first ~1000 words beats no embedding at all.
const MAX_INPUT_CHARS = 4000;
const DEFAULT_DIMENSIONS = 1536;

/**
 * Embedder backed by the real provider, configured entirely from env
 * (EMBEDDING_API_KEY / EMBEDDING_BASE_URL / EMBEDDING_MODEL /
 * EMBEDDING_DIMENSIONS). Never throws at construction: a missing key must
 * not keep the pod from booting — `enabled` is false instead, write paths
 * skip quietly and search answers 503.
 */
@Injectable()
export class EmbeddingsService implements Embedder {
  readonly model: string;
  readonly dimensions: number;
  readonly enabled: boolean;

  constructor(private readonly client: EmbeddingClient) {
    this.model = process.env.EMBEDDING_MODEL ?? '';
    const parsed = Number(
      process.env.EMBEDDING_DIMENSIONS ?? DEFAULT_DIMENSIONS,
    );
    this.dimensions =
      Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DIMENSIONS;
    // Base URL included: without it nothing can ever succeed, so it must
    // not report enabled and then fail every call.
    this.enabled =
      Boolean(process.env.EMBEDDING_API_KEY) &&
      Boolean(process.env.EMBEDDING_BASE_URL) &&
      this.model !== '';
  }

  async embedText(text: string): Promise<number[]> {
    const [vector] = await this.embedTexts([text]);
    if (!vector) {
      throw new Error('embedding provider returned no vector');
    }
    return vector;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!this.enabled) {
      throw new Error(
        'embeddings are not configured (EMBEDDING_API_KEY, EMBEDDING_BASE_URL, EMBEDDING_MODEL)',
      );
    }
    if (texts.length === 0) {
      return [];
    }
    return this.client.embed({
      model: this.model,
      input: texts.map((text) => text.slice(0, MAX_INPUT_CHARS)),
      dimensions: this.dimensions,
    });
  }
}
