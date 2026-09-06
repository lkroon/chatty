/** What a confirm-gated write proposal will do once the user confirms it. */
export type ProposalKind = 'calendar_event' | 'task' | 'email';

/**
 * A proposal's state as the UI sees it.
 *
 * 'expired' is never stored: a row sits at 'pending' forever, and
 * toProposalCard downgrades it to 'expired' once it is older than the TTL.
 * A three-day-old card must re-prompt, not silently fire.
 */
export type ProposalStatus =
  | 'pending'
  | 'executing'
  | 'executed'
  | 'discarded'
  | 'failed'
  | 'expired';

/** One "When: Tue 8 Sep 2026, 15:00 – 15:30" line on the card. */
export interface ProposalField {
  label: string;
  value: string;
}

/**
 * Everything the transcript needs to render one proposal. Built on the
 * server from the stored row, so the card and the executor can never
 * disagree about what will be sent.
 */
export interface ProposalCard {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  /** The event/task title, or the email's subject. */
  title: string;
  fields: ProposalField[];
  /** Link to the created item, when Google returned one. Null otherwise. */
  link: string | null;
  /** Human explanation when status is 'failed'. Null otherwise. */
  error: string | null;
  /**
   * Whether Confirm/Discard should be offered. Computed on the server, so
   * the client never re-derives lifecycle rules (a failed calendar event may
   * be retried — its id is the idempotency key — a failed send may not).
   */
  confirmable: boolean;
  /**
   * ISO instant after which this proposal stops being confirmable, so the
   * card and Today's list can both say when it lapses. Null for anything not
   * pending — a settled proposal has no deadline left to run.
   */
  expiresAt: string | null;
  /**
   * The conversation the proposal was made in, so Today's list can point at
   * the card. Null when the tool call had no conversation (it always does in
   * practice — the column is nullable, and this mirrors it rather than
   * pretending otherwise).
   */
  conversationId: string | null;
}
