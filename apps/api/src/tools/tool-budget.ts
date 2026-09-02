/**
 * Wave 1.5 budget constants — frozen, not per-agent judgement. A tool loop
 * re-sends the whole message array on every round, so injected text is paid
 * for once per remaining round; these caps are the difference between a few
 * cents and a few dollars per question on a metered key. They live here as
 * exported constants, not env vars — they are not operator knobs.
 */

/**
 * Upstream calls that may request tools. The round after the last one is
 * sent with no `tools` param, so the model must answer.
 *
 * Raised from 3 to 5 deliberately. Small models are the intended workload
 * here, and they spend rounds badly — a wasted search, a malformed
 * argument, a re-search of the same thing. Three rounds left too little
 * room to recover from one of those and still answer from the web. The
 * expensive knob is TOOL_TOTAL_MAX_CHARS below, not this one: rounds cost
 * a re-send of the message array, whereas injected characters are paid for
 * again on every remaining round. That ceiling stays where it was.
 */
export const MAX_TOOL_ROUNDS = 5;

/** Results per `web_search` call — title, url, snippet only. Never full pages. */
export const SEARCH_MAX_RESULTS = 5;

/**
 * Total `web_fetch` calls across all rounds of one user message. Lifted
 * 2 -> 3 alongside MAX_TOOL_ROUNDS: with five rounds available, two page
 * reads was the binding constraint on "search, read the wrong page, read
 * the right one". Still cheap — the pages are truncated by
 * FETCH_MAX_CHARS and charged against the same total budget.
 */
export const MAX_FETCHES_PER_EXCHANGE = 3;

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
