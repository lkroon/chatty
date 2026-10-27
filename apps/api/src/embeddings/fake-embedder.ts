import type { Embedder } from './embeddings.service';

/**
 * Deterministic fakes for the Embedder seam, shared by the integration
 * specs. oneHot vectors are orthogonal by construction, so cosine
 * distance between different keywords is exactly 1 and between the same
 * keyword exactly 0 — ranking assertions need no network and no
 * tolerance for anything except float noise.
 */

/** Must equal the vector(1536) column in the message_embeddings migration. */
export const EMBEDDING_DIMENSIONS = 1536;

export function oneHot(
  index: number,
  dimensions: number = EMBEDDING_DIMENSIONS,
): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  vector[index] = 1;
  return vector;
}

/** Never configured: write paths skip quietly, search refuses with 503. */
export function disabledEmbedder(): Embedder {
  const fail = (): Promise<never> =>
    Promise.reject(new Error('embeddings are not configured'));
  return {
    enabled: false,
    model: '',
    embedText: fail,
    embedTexts: fail,
  };
}

/**
 * Maps text to the one-hot vector of the first keyword it contains
 * (case-insensitive). Text matching no keyword maps to an orthogonal
 * catch-all index, so it still ranks below every real keyword.
 */
export function keywordEmbedder(keywords: string[]): Embedder {
  const indexOf = (text: string): number => {
    const lowered = text.toLowerCase();
    const index = keywords.findIndex((keyword) =>
      lowered.includes(keyword.toLowerCase()),
    );
    return index === -1 ? keywords.length : index;
  };
  return {
    enabled: true,
    model: 'fake-embedding-model',
    embedText: async (text) => oneHot(indexOf(text)),
    embedTexts: async (texts) => texts.map((text) => oneHot(indexOf(text))),
  };
}
