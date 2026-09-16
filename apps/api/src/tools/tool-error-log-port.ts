import type { ToolFailureKind } from './tool-failure-kind';

export interface ToolErrorRecord {
  /** The assistant message whose exchange made the call. */
  messageId: string;
  accountId: number;
  toolName: string;
  failureKind: ToolFailureKind;
  /** The model's own arguments. Truncated by the implementation, not here. */
  rawArguments: string;
  /** Our sentence about the failure. Never a remote response body. */
  detail: string;
}

/**
 * The tool layer's one route into the error log.
 *
 * Narrow in the same way ProposalToolPort is: the runtime can append a
 * failure and can do nothing else — not read one back, not read anyone
 * else's, not delete. `record` must never reject and never throw: a
 * diagnostic that can fail an exchange is worse than no diagnostic, and
 * this is called on the path where something has already gone wrong.
 */
export interface ToolErrorLogPort {
  record(error: ToolErrorRecord): Promise<void>;
}
