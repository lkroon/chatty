import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { ProposalCard as ProposalCardModel } from '@contracts';

import { testProposalCard } from '../core/test-proposal';
import { ProposalCard } from './proposal-card';

describe('ProposalCard', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ProposalCard>>;

  function setCard(card: ProposalCardModel, busy = false): HTMLElement {
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('busy', busy);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProposalCard],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(ProposalCard);
  });

  it('renders the title and every field', () => {
    const el = setCard(testProposalCard());
    expect(el.textContent).toContain('Dentist');
    expect(el.textContent).toContain('When');
    expect(el.textContent).toContain('Tue 8 Sep 2026, 15:00 – 15:45');
    expect(el.textContent).toContain('Kerkstraat 1');
  });

  it('says when a pending proposal lapses, and stops saying it once settled', () => {
    const pending = setCard(testProposalCard({ expiresAt: '2026-09-08T09:59:00.000Z' }));
    expect(pending.querySelector('.proposal__expiry')!.textContent).toContain('Expires');
    const settled = setCard(
      testProposalCard({ status: 'executed', confirmable: false, expiresAt: null }),
    );
    expect(settled.querySelector('.proposal__expiry')).toBeNull();
  });

  it('emits confirmed and discarded when the buttons are pressed', () => {
    const el = setCard(testProposalCard());
    let confirmed = 0;
    let discarded = 0;
    fixture.componentInstance.confirmed.subscribe(() => (confirmed += 1));
    fixture.componentInstance.discarded.subscribe(() => (discarded += 1));

    el.querySelector<HTMLButtonElement>('.proposal__confirm')!.click();
    el.querySelector<HTMLButtonElement>('.proposal__discard')!.click();

    expect(confirmed).toBe(1);
    expect(discarded).toBe(1);
  });

  it('offers no buttons once the proposal is not confirmable', () => {
    const el = setCard(testProposalCard({ status: 'executed', confirmable: false }));
    expect(el.querySelector('.proposal__confirm')).toBeNull();
    expect(el.querySelector('.proposal__discard')).toBeNull();
    expect(el.textContent).toContain('Added to your calendar');
  });

  it('disables the buttons while an action is in flight', () => {
    const el = setCard(testProposalCard(), true);
    expect(el.querySelector<HTMLButtonElement>('.proposal__confirm')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('.proposal__discard')!.disabled).toBe(true);
  });

  it('shows the error and still offers a retry on a failed calendar event', () => {
    const el = setCard(
      testProposalCard({ status: 'failed', error: 'Calendar create failed (503)', confirmable: true }),
    );
    expect(el.textContent).toContain('Calendar create failed (503)');
    expect(el.querySelector<HTMLButtonElement>('.proposal__confirm')!.textContent).toContain(
      'Try again',
    );
  });

  it('renders a long email body in full, so the card shows what will be sent', () => {
    const body = 'x'.repeat(400);
    const el = setCard(
      testProposalCard({
        kind: 'email',
        fields: [
          { label: 'To', value: 'a@example.com' },
          { label: 'Message', value: body },
        ],
      }),
    );
    expect(el.textContent).toContain(body);
  });

  it('links to the created item when there is a link', () => {
    const el = setCard(
      testProposalCard({ status: 'executed', confirmable: false, link: 'https://cal/evt-1' }),
    );
    const link = el.querySelector<HTMLAnchorElement>('.proposal__link')!;
    expect(link.getAttribute('href')).toBe('https://cal/evt-1');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('says an expired proposal needs asking again', () => {
    const el = setCard(testProposalCard({ status: 'expired', confirmable: false }));
    expect(el.textContent).toContain('Expired');
  });

  it('names the right action for a task and for an email', () => {
    expect(
      setCard(testProposalCard({ kind: 'task', status: 'executed', confirmable: false }))
        .textContent,
    ).toContain('Added to your tasks');
    expect(
      setCard(testProposalCard({ kind: 'email', status: 'executed', confirmable: false }))
        .textContent,
    ).toContain('Sent');
  });
});
