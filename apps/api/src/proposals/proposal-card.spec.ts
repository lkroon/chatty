import type { ProposalRow } from './proposal-row';
import { toProposalCard } from './proposal-card';
import { proposalTtlMs } from './proposal-policy';

const NOW = new Date('2026-09-05T10:00:00Z');

function row(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: 'p1',
    accountId: 1,
    conversationId: 'c1',
    kind: 'calendar_event',
    payload: {
      title: 'Dentist',
      start: '2026-09-08T15:00:00',
      end: '2026-09-08T15:45:00',
      location: 'Kerkstraat 1',
      description: null,
    },
    status: 'pending',
    externalId: null,
    externalLink: null,
    error: null,
    createdAt: new Date('2026-09-05T09:59:00Z'),
    updatedAt: new Date('2026-09-05T09:59:00Z'),
    ...overrides,
  };
}

describe('toProposalCard', () => {
  it('renders a calendar event with a same-day time range', () => {
    const card = toProposalCard(row(), NOW);
    expect(card.title).toBe('Dentist');
    expect(card.status).toBe('pending');
    expect(card.confirmable).toBe(true);
    expect(card.conversationId).toBe('c1');
    expect(card.fields).toEqual([
      { label: 'When', value: 'Tue 8 Sep 2026, 15:00 – 15:45' },
      { label: 'Where', value: 'Kerkstraat 1' },
    ]);
  });

  it('dates the deadline from creation, and only while pending', () => {
    // createdAt + the TTL. Derived from the same constant the expiry check
    // uses, so the card can never promise a day the row will not honour.
    const pending = toProposalCard(row(), NOW);
    expect(pending.expiresAt).toBe(
      new Date(row().createdAt.getTime() + proposalTtlMs()).toISOString(),
    );
    expect(toProposalCard(row({ status: 'executed' }), NOW).expiresAt).toBeNull();
    expect(toProposalCard(row({ status: 'discarded' }), NOW).expiresAt).toBeNull();
  });

  it('spells out both days when an event crosses midnight', () => {
    const card = toProposalCard(
      row({
        payload: {
          title: 'Night shift',
          start: '2026-09-08T23:30:00',
          end: '2026-09-09T00:15:00',
          location: null,
          description: null,
        },
      }),
      NOW,
    );
    expect(card.fields).toEqual([
      { label: 'When', value: 'Tue 8 Sep 2026, 23:30 – Wed 9 Sep 2026, 00:15' },
    ]);
  });

  it('renders a task with and without a due date', () => {
    const withDue = toProposalCard(
      row({ kind: 'task', payload: { title: 'Renew passport', due: '2026-09-30', notes: 'Town hall' } }),
      NOW,
    );
    expect(withDue.title).toBe('Renew passport');
    expect(withDue.fields).toEqual([
      { label: 'Due', value: 'Wed 30 Sep 2026' },
      { label: 'Notes', value: 'Town hall' },
    ]);

    const withoutDue = toProposalCard(
      row({ kind: 'task', payload: { title: 'Buy milk', due: null, notes: null } }),
      NOW,
    );
    expect(withoutDue.fields).toEqual([{ label: 'Due', value: 'No due date' }]);
  });

  it('renders an email with the subject as the title', () => {
    const card = toProposalCard(
      row({
        kind: 'email',
        payload: { to: ['a@example.com', 'b@example.com'], subject: 'Lunch?', body: 'Are you free?' },
      }),
      NOW,
    );
    expect(card.title).toBe('Lunch?');
    expect(card.fields).toEqual([
      { label: 'To', value: 'a@example.com, b@example.com' },
      { label: 'Message', value: 'Are you free?' },
    ]);
  });

  it('never truncates the email body — the card must show exactly what is sent', () => {
    const body = 'x'.repeat(400);
    const card = toProposalCard(
      row({
        kind: 'email',
        payload: { to: ['a@example.com'], subject: 'Long', body },
      }),
      NOW,
    );
    const message = card.fields.find((f) => f.label === 'Message')!.value;
    expect(message).toBe(body);
    expect(message).not.toContain('…');
  });

  it('still previews a long calendar description, which is not sent to anyone', () => {
    const card = toProposalCard(
      row({
        payload: {
          title: 'Dentist',
          start: '2026-09-08T15:00:00',
          end: '2026-09-08T15:45:00',
          location: null,
          description: 'y'.repeat(400),
        },
      }),
      NOW,
    );
    const notes = card.fields.find((f) => f.label === 'Notes')!.value;
    expect(notes.length).toBe(301);
    expect(notes.endsWith('…')).toBe(true);
  });

  it('shows an executed proposal as done, with its link and no buttons', () => {
    const card = toProposalCard(
      row({ status: 'executed', externalLink: 'https://calendar.google.com/event?eid=abc' }),
      NOW,
    );
    expect(card.status).toBe('executed');
    expect(card.link).toBe('https://calendar.google.com/event?eid=abc');
    expect(card.confirmable).toBe(false);
  });

  it('expires a pending proposal older than the TTL', () => {
    const card = toProposalCard(
      row({ createdAt: new Date('2026-09-01T09:00:00Z') }),
      NOW,
    );
    expect(card.status).toBe('expired');
    expect(card.confirmable).toBe(false);
  });

  it('treats a long-stuck executing row as an interrupted failure', () => {
    const card = toProposalCard(
      row({ status: 'executing', updatedAt: new Date('2026-09-05T09:50:00Z') }),
      NOW,
    );
    expect(card.status).toBe('failed');
    expect(card.error).toContain('Interrupted');
    // calendar_event is retryable — its id is the idempotency key.
    expect(card.confirmable).toBe(true);
  });

  it('leaves a freshly executing row alone', () => {
    const card = toProposalCard(row({ status: 'executing' }), NOW);
    expect(card.status).toBe('executing');
    expect(card.confirmable).toBe(false);
  });

  it('offers a retry on a failed calendar event but never on a failed email', () => {
    expect(toProposalCard(row({ status: 'failed', error: 'Calendar create failed (503)' }), NOW).confirmable).toBe(
      true,
    );
    expect(
      toProposalCard(
        row({
          kind: 'email',
          status: 'failed',
          error: 'Gmail send failed (503)',
          payload: { to: ['a@example.com'], subject: 'S', body: 'B' },
        }),
        NOW,
      ).confirmable,
    ).toBe(false);
  });

  it('stops offering a retry once the TTL has run out', () => {
    // The SQL claim refuses a row older than the TTL whatever its status, so
    // a "Try again" button here would only ever produce a 409.
    const card = toProposalCard(
      row({
        status: 'failed',
        error: 'Calendar create failed (503)',
        createdAt: new Date('2026-09-01T09:00:00Z'),
      }),
      NOW,
    );
    expect(card.confirmable).toBe(false);
  });

  it('never offers buttons on a discarded proposal', () => {
    expect(toProposalCard(row({ status: 'discarded' }), NOW).confirmable).toBe(false);
  });
});
