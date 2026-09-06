import type { ProposalKind } from '@contracts/proposal';

const DEFAULT_TTL_DAYS = 3;

/**
 * How long a pending proposal may still be confirmed.
 *
 * A card you tap three days later should re-prompt, not silently create a
 * meeting for a date you have forgotten about. Enforced twice on purpose: the
 * SQL claim refuses an old row (proposals.repository.ts) and the card renders
 * it as expired (proposal-card.ts). Neither alone is enough — one is the
 * security boundary, the other is what the user sees.
 */
export function proposalTtlDays(): number {
  const parsed = Number(process.env.PROPOSAL_TTL_DAYS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS;
}

export function proposalTtlMs(): number {
  return proposalTtlDays() * 24 * 60 * 60 * 1000;
}

/**
 * A row stuck at 'executing' for longer than this had its process die
 * mid-call. After the window it displays as failed, and a retryable kind may
 * be claimed again — which is why the window is minutes, not seconds: it must
 * comfortably outlast a slow Google call so a live request is never stolen.
 */
export const EXECUTING_STALE_MINUTES = 5;
export const EXECUTING_STALE_MS = EXECUTING_STALE_MINUTES * 60 * 1000;

/**
 * Kinds whose failed execution may be retried.
 *
 * Only calendar events: the proposal id doubles as the Google event id, so a
 * retry is exactly-once by construction. A task or an email that failed after
 * the request reached Google would be created or sent twice, and there is no
 * client-supplied key for either — so those failures are terminal and the
 * user asks again in chat.
 */
export const RETRYABLE_KINDS: ReadonlySet<ProposalKind> = new Set<ProposalKind>([
  'calendar_event',
]);

/** IANA zone attached to calendar times. Shared with the briefing. */
export function appTimeZone(): string {
  return process.env.BRIEFING_TIMEZONE ?? 'Europe/Amsterdam';
}
