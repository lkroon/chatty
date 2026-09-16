/**
 * How a tool call failed, set at the site that knows.
 *
 * The alternative was sniffing the message we hand the model — which is
 * written for the model to read and route around, is reworded freely, and
 * would silently reclassify every failure the day someone improved the
 * wording. A failure site that knows why it failed says so once, in a word.
 */
export const TOOL_FAILURE_KINDS = [
  /** `rawArguments` was not JSON, or lacked the one field the tool needs. */
  'invalid_arguments',
  /** A tool name the runtime does not implement. */
  'unknown_tool',
  /** The search provider threw — unreachable, non-2xx, or malformed body. */
  'search_failed',
  /** url-guard refused the URL, on the first hop or after a redirect. */
  'blocked_url',
  /** The fetch itself threw: DNS, TLS, connection refused. */
  'fetch_failed',
  /** The page answered, with a status we cannot read. */
  'http_error',
  /** The page answered with something that is not text we can extract. */
  'unsupported_content_type',
  /** Redirect chain longer than the cap, or a redirect with no Location. */
  'too_many_redirects',
  /** Body past FETCH_MAX_BYTES, or a page whose read we abandoned. */
  'response_too_large',
  /** The per-call deadline passed, or the client hung up. */
  'timeout',
  /** The exchange has no fetches left. */
  'budget_exhausted',
  /** A write tool was called while write tools are off. */
  'tool_unavailable',
  /** A proposal's arguments were rejected — a bad date, a missing field. */
  'proposal_rejected',
  /** A bug: an implementation threw where it promised not to. */
  'unexpected',
] as const;

export type ToolFailureKind = (typeof TOOL_FAILURE_KINDS)[number];
