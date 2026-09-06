import type { ProposalCard } from '@contracts';

/**
 * A pending calendar proposal, for specs. Lives in src/ (not inside one
 * spec) because four stub ChatApi implementations and two component specs
 * all need the same shape, and a drifting copy in each is how a contract
 * change stops being caught.
 */
export function testProposalCard(overrides: Partial<ProposalCard> = {}): ProposalCard {
  return {
    id: 'p1',
    kind: 'calendar_event',
    status: 'pending',
    title: 'Dentist',
    fields: [
      { label: 'When', value: 'Tue 8 Sep 2026, 15:00 – 15:45' },
      { label: 'Where', value: 'Kerkstraat 1' },
    ],
    link: null,
    error: null,
    confirmable: true,
    // Far enough out that a spec never trips the "expires today" wording.
    expiresAt: '2026-09-08T09:59:00.000Z',
    conversationId: 'c1',
    ...overrides,
  };
}
