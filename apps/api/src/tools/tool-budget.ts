/**
 * Wave 1.5 budget constants — frozen, not per-agent judgement. A tool loop
 * re-sends the whole message array on every round, so injected text is paid
 * for once per remaining round; these caps are the difference between a few
 * cents and a few dollars per question on a metered key. They live here as
 * exported constants, not env vars — they are not operator knobs.
 */

/** Upstream calls that may request tools. Round 4 is sent with no `tools` param, so the model must answer. */
export const MAX_TOOL_ROUNDS = 3;

/** Results per `web_search` call — title, url, snippet only. Never full pages. */
export const SEARCH_MAX_RESULTS = 5;

/** Total `web_fetch` calls across all rounds of one user message. */
export const MAX_FETCHES_PER_EXCHANGE = 2;

/** Hard truncation of one fetched page's extracted text. */
export const FETCH_MAX_CHARS = 8000;

/** Total tool output injected across the whole exchange. The real ceiling. */
export const TOOL_TOTAL_MAX_CHARS = 20000;

/** Per search request, in ms. */
export const SEARCH_TIMEOUT_MS = 5000;

/** Per page fetch, including redirects, in ms. */
export const FETCH_TIMEOUT_MS = 8000;

/** 2 MiB read cap; abort the body beyond it. */
export const FETCH_MAX_BYTES = 2097152;

/**
 * Per-exchange mutable budget, shared across every `ToolRuntime.execute`
 * call in one loop. Constructed once by the chat service and passed down —
 * never reconstructed mid-exchange.
 */
export class ToolBudget {
  fetchesRemaining = MAX_FETCHES_PER_EXCHANGE;
  charsRemaining = TOOL_TOTAL_MAX_CHARS;

  /** Decrements and returns false when exhausted. Call before fetching, not after. */
  claimFetch(): boolean {
    if (this.fetchesRemaining <= 0) {
      return false;
    }
    this.fetchesRemaining -= 1;
    return true;
  }

  /** Truncates `text` to what remains, decrements, returns what may be used. */
  claimChars(text: string): string {
    if (this.charsRemaining <= 0) {
      return '';
    }
    const usable = text.length <= this.charsRemaining ? text : text.slice(0, this.charsRemaining);
    this.charsRemaining -= usable.length;
    return usable;
  }
}
