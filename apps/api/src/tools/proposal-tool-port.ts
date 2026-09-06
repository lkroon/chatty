import type { ProposalCard } from '@contracts/proposal';

/**
 * What a write tool got for its trouble. `ok: false` carries a message
 * written for the *model* to read and retry with — a bad date must come back
 * as a correctable tool result, not an exception.
 */
export type ProposalToolOutcome =
  | { ok: true; card: ProposalCard }
  | { ok: false; message: string };

/**
 * The single call `tools/` makes into the proposals module.
 *
 * Deliberately this narrow: the tool layer can create a proposal for one
 * account and can do nothing else — it cannot confirm, execute, list or read
 * anyone's proposals. ProposalsService implements it (Task 12); ChatModule
 * injects the service into the runtime factory (Task 16).
 */
export interface ProposalToolPort {
  createFromToolCall(input: {
    accountId: number;
    conversationId: string;
    toolName: string;
    rawArguments: string;
  }): Promise<ProposalToolOutcome>;
}
