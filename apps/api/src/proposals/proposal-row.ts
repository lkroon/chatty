import type { ProposalKind, ProposalStatus } from '@contracts/proposal';
import type { ProposalPayload } from './proposal-payloads';

/**
 * The statuses that are actually stored. 'expired' is not one of them — it is
 * derived from `createdAt` when the card is built (see proposal-card.ts).
 */
export type StoredProposalStatus = Exclude<ProposalStatus, 'expired'>;

/** One row of the `proposals` table, as every file in this folder sees it. */
export interface ProposalRow {
  id: string;
  accountId: number;
  conversationId: string | null;
  kind: ProposalKind;
  payload: ProposalPayload;
  status: StoredProposalStatus;
  externalId: string | null;
  externalLink: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}
