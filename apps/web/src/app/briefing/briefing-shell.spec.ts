import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { Briefing, GoogleConnectionStatus } from '@contracts';

import { BRIEFING_API, BriefingApi } from './briefing-api';
import { BriefingShell } from './briefing-shell';
import { BRIEFING_CACHE_KEY, itemFingerprint, writeBriefingCache } from '../core/briefing-cache';

// The briefing cache keys on `date` and rejects anything not from "today"
// (see readBriefingCache in core/briefing-cache.ts), so the fixture's date
// must track the real calendar day rather than a fixed string.
const TODAY_ISO = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const CONNECTED: Briefing = {
  date: TODAY_ISO,
  timeZone: 'Europe/Amsterdam',
  summary: 'A quiet day.',
  calendar: {
    status: 'ok',
    items: [
      {
        id: 'e1',
        title: 'Standup',
        start: '2026-09-05T09:00:00+02:00',
        end: null,
        allDay: false,
        location: null,
      },
    ],
  },
  tasks: { status: 'ok', items: [] },
  mail: {
    status: 'ok',
    items: [{ id: 'm1', from: 'Alice', subject: 'Lunch?', snippet: 's', receivedAt: '' }],
  },
  mailHasMore: false,
  pending: [],
  generatedAt: '2026-09-05T06:00:00.000Z',
};

class StubApi implements BriefingApi {
  briefing: Briefing = CONNECTED;
  status: GoogleConnectionStatus = { connected: true, scopes: [], needsReconnect: false };
  failBriefing = false;
  /** Consumed by the next getBriefing() call only, then resets itself. */
  failNextBriefing = false;
  failCompleteTask = false;
  fullCalls = 0;
  itemCalls = 0;
  completed: string[] = [];

  getBriefing() {
    this.fullCalls++;
    if (this.failNextBriefing) {
      this.failNextBriefing = false;
      return throwError(() => new Error('boom'));
    }
    return this.failBriefing ? throwError(() => new Error('boom')) : of(this.briefing);
  }
  getBriefingItems() {
    this.itemCalls++;
    const { summary, ...items } = this.briefing;
    return of(items);
  }
  completeTask(id: string) {
    if (this.failCompleteTask) {
      return throwError(() => new Error('boom'));
    }
    this.completed.push(id);
    return of(undefined);
  }
  mailActions: Array<{ id: string; action: string }> = [];
  markMailRead(id: string) {
    this.mailActions.push({ id, action: 'read' });
    return of(undefined);
  }
  archiveMail(id: string) {
    this.mailActions.push({ id, action: 'archive' });
    return of(undefined);
  }
  getGoogleStatus() {
    return of(this.status);
  }
  disconnectGoogle() {
    return of(undefined);
  }
}

/**
 * `overrideComponent`, not `providers`, is what actually swaps the API here.
 *
 * BriefingShell declares `providers: [{ provide: BRIEFING_API, useClass: RealBriefingApi }]` on
 * itself, and a component-level provider wins over anything the TestBed provides — a plain
 * `providers: [{ provide: BRIEFING_API, useValue: api }]` would be silently ignored and the specs
 * would hit the real backend over `fetch`. chat-shell.spec.ts:68 overrides CHAT_API the same way,
 * for the same reason.
 */
// Stashed by setup() so tests that need to act after the initial render (a
// click, then re-reading the DOM) can call detectChanges() again without
// changing setup()'s return type for every existing call site.
let currentFixture: ReturnType<typeof TestBed.createComponent<BriefingShell>>;

function setup(api: StubApi): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [BriefingShell],
    providers: [provideZonelessChangeDetection(), provideRouter([])],
  }).overrideComponent(BriefingShell, {
    set: { providers: [{ provide: BRIEFING_API, useValue: api }] },
  });
  const fixture = TestBed.createComponent(BriefingShell);
  fixture.detectChanges();
  currentFixture = fixture;
  return fixture.nativeElement as HTMLElement;
}

describe('BriefingShell', () => {
  // Every persisted briefing now keys on "today", which the fixture's date
  // deliberately tracks (see TODAY_ISO above) — so a successful test's
  // persist() call leaves a real, valid cache entry in localStorage for the
  // next test to inherit unless each test starts from a clean slate.
  beforeEach(() => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
  });

  it('renders the summary and both sections', () => {
    const el = setup(new StubApi());
    expect(el.textContent).toContain('A quiet day.');
    expect(el.textContent).toContain('Standup');
    expect(el.textContent).toContain('Lunch?');
  });

  it('shows a connect link when Google is not connected', () => {
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      summary: '',
      calendar: { status: 'not_connected' },
      mail: { status: 'not_connected' },
    };
    const link = setup(api).querySelector('a.connect') as HTMLAnchorElement;
    // A plain <a>, not a routerLink: /auth/google/connect is a server route
    // and needs a full page navigation, like the login button.
    expect(link.getAttribute('href')).toBe('/auth/google/connect');
  });

  it('renders a per-section error without blanking the page', () => {
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      mail: { status: 'error', message: 'Could not read your mail.' },
    };
    const el = setup(api);
    expect(el.textContent).toContain('Could not read your mail.');
    expect(el.textContent).toContain('Standup');
  });

  it('shows an error message when the whole request fails', () => {
    const api = new StubApi();
    api.failBriefing = true;
    expect(setup(api).textContent).toContain("Couldn't load your briefing");
  });

  it('shows empty-state hints when a connected briefing has no events or mail', () => {
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      summary: '',
      calendar: { status: 'ok', items: [] },
      mail: { status: 'ok', items: [] },
    };
    const el = setup(api);
    expect(el.textContent).toContain('Nothing scheduled.');
    expect(el.textContent).toContain('No unread mail.');
  });

  it('lists what is waiting, above the agenda', () => {
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      pending: [
        {
          id: 'p1',
          kind: 'email' as const,
          status: 'pending' as const,
          title: 'Lunch on Thursday?',
          fields: [{ label: 'To', value: 'sanne@example.com' }],
          link: null,
          error: null,
          confirmable: true,
          expiresAt: '2026-09-08T09:59:00.000Z',
          conversationId: 'c1',
        },
      ],
    };
    const el = setup(api);
    expect(el.textContent).toContain('Waiting on you');
    expect(el.textContent).toContain('Lunch on Thursday?');
    // A pointer, not a control: Today never confirms.
    expect(el.querySelector('.proposal__confirm')).toBeNull();
  });

  it('fetches the full briefing on a cold load', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    setup(api);
    expect(api.fullCalls).toBe(1);
    expect(api.itemCalls).toBe(0);
  });

  it('paints from a warm cache and revalidates items only', () => {
    const { summary, ...items } = CONNECTED;
    writeBriefingCache({
      items,
      summary: 'Cached summary.',
      summaryFingerprint: itemFingerprint(items),
      dismissedTaskIds: [],
      cachedAt: Date.now(),
    });
    const api = new StubApi();
    const el = setup(api);
    expect(el.textContent).toContain('Cached summary.');
    expect(api.fullCalls).toBe(0);
    expect(api.itemCalls).toBe(1);
    localStorage.removeItem(BRIEFING_CACHE_KEY);
  });

  it('renders a refresh control', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const el = setup(new StubApi());
    expect(el.querySelector('[data-testid="refresh"]')).toBeTruthy();
  });

  it('skips regenerating the summary on a full refresh when the item fingerprint still matches', () => {
    const { summary, ...items } = CONNECTED;
    writeBriefingCache({
      items,
      summary: 'Cached summary.',
      summaryFingerprint: itemFingerprint(items),
      dismissedTaskIds: [],
      cachedAt: Date.now(),
    });
    const api = new StubApi();
    const el = setup(api);
    expect(api.fullCalls).toBe(0);

    el.querySelector<HTMLButtonElement>('[data-testid="refresh"]')!.click();
    currentFixture.detectChanges();

    // The item set (and therefore its fingerprint) hasn't changed, so the
    // inner getBriefing() re-fetch that would regenerate the summary is
    // skipped entirely.
    expect(api.fullCalls).toBe(0);
    expect(el.textContent).toContain('Cached summary.');
    localStorage.removeItem(BRIEFING_CACHE_KEY);
  });

  it('regenerates the summary on a full refresh when the item fingerprint changed', () => {
    const { summary, ...items } = CONNECTED;
    writeBriefingCache({
      items,
      summary: 'Cached summary.',
      summaryFingerprint: itemFingerprint(items),
      dismissedTaskIds: [],
      cachedAt: Date.now(),
    });
    const api = new StubApi();
    const el = setup(api);
    expect(api.fullCalls).toBe(0);

    api.briefing = {
      ...CONNECTED,
      summary: 'Fresh summary.',
      calendar: {
        status: 'ok' as const,
        items: [
          {
            id: 'e1',
            title: 'Standup',
            start: '2026-09-05T09:00:00+02:00',
            end: null,
            allDay: false,
            location: null,
          },
          {
            id: 'e2',
            title: 'Follow-up',
            start: '2026-09-05T11:00:00+02:00',
            end: null,
            allDay: false,
            location: null,
          },
        ],
      },
    };

    el.querySelector<HTMLButtonElement>('[data-testid="refresh"]')!.click();
    currentFixture.detectChanges();

    // The item set changed, so the inner getBriefing() fires exactly once
    // to fetch the regenerated summary, and it ends up on screen.
    expect(api.fullCalls).toBe(1);
    expect(el.textContent).toContain('Fresh summary.');
    expect(el.textContent).toContain('Follow-up');
    localStorage.removeItem(BRIEFING_CACHE_KEY);
  });

  it('keeps the freshly swapped-in items and clears refreshing when the inner summary regeneration fails', () => {
    const { summary, ...items } = CONNECTED;
    writeBriefingCache({
      items,
      summary: 'Cached summary.',
      summaryFingerprint: itemFingerprint(items),
      dismissedTaskIds: [],
      cachedAt: Date.now(),
    });
    const api = new StubApi();
    const el = setup(api);

    api.briefing = {
      ...CONNECTED,
      calendar: {
        status: 'ok' as const,
        items: [
          {
            id: 'e1',
            title: 'Standup',
            start: '2026-09-05T09:00:00+02:00',
            end: null,
            allDay: false,
            location: null,
          },
          {
            id: 'e2',
            title: 'Follow-up',
            start: '2026-09-05T11:00:00+02:00',
            end: null,
            allDay: false,
            location: null,
          },
        ],
      },
    };
    api.failNextBriefing = true;

    el.querySelector<HTMLButtonElement>('[data-testid="refresh"]')!.click();
    currentFixture.detectChanges();

    // The failing inner call must not crash the component, must not get the
    // refresh control stuck disabled, and must not wipe the items that
    // getBriefingItems() already swapped in.
    const button = el.querySelector<HTMLButtonElement>('[data-testid="refresh"]')!;
    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('↻');
    expect(el.textContent).toContain('Follow-up');
    localStorage.removeItem(BRIEFING_CACHE_KEY);
  });

  it('renders due tasks with a complete control', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      tasks: {
        status: 'ok',
        items: [
          { id: 't1', title: 'Renew passport', due: '2026-09-05', overdue: false, notes: null },
        ],
      },
    };
    const el = setup(api);
    expect(el.textContent).toContain('Renew passport');
    expect(el.querySelector('[data-testid="complete-t1"]')).toBeTruthy();
  });

  it('removes a task optimistically and calls the API', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      tasks: {
        status: 'ok',
        items: [
          { id: 't1', title: 'Renew passport', due: '2026-09-05', overdue: false, notes: null },
        ],
      },
    };
    const el = setup(api);
    (el.querySelector('[data-testid="complete-t1"]') as HTMLButtonElement).click();
    expect(api.completed).toEqual(['t1']);
  });

  it('dismisses a task locally, without calling the API', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      tasks: {
        status: 'ok',
        items: [
          { id: 't1', title: 'Renew passport', due: '2026-09-05', overdue: false, notes: null },
        ],
      },
    };
    const el = setup(api);

    (el.querySelector('[data-testid="dismiss-t1"]') as HTMLButtonElement).click();
    currentFixture.detectChanges();

    expect(el.querySelector('[data-testid="dismiss-t1"]')).toBeNull();
    expect(el.textContent).not.toContain('Renew passport');
    expect(api.completed).toEqual([]);
  });

  it('shows an undo snackbar after dismissing a task, and undo brings the row back', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      tasks: {
        status: 'ok',
        items: [
          { id: 't1', title: 'Renew passport', due: '2026-09-05', overdue: false, notes: null },
        ],
      },
    };
    const el = setup(api);

    (el.querySelector('[data-testid="dismiss-t1"]') as HTMLButtonElement).click();
    currentFixture.detectChanges();

    const snackbar = el.querySelector('.snackbar');
    expect(snackbar).toBeTruthy();
    expect(snackbar?.textContent).toContain('Undo');

    (el.querySelector('.snackbar__action') as HTMLButtonElement).click();
    currentFixture.detectChanges();

    expect(el.querySelector('[data-testid="dismiss-t1"]')).toBeTruthy();
    expect(el.textContent).toContain('Renew passport');
  });

  it('restores the task and shows a button-less error snackbar when completing fails', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.failCompleteTask = true;
    api.briefing = {
      ...CONNECTED,
      tasks: {
        status: 'ok',
        items: [
          { id: 't1', title: 'Renew passport', due: '2026-09-05', overdue: false, notes: null },
        ],
      },
    };
    const el = setup(api);

    (el.querySelector('[data-testid="complete-t1"]') as HTMLButtonElement).click();
    currentFixture.detectChanges();

    // The optimistic hide is reverted: the row is back.
    expect(el.querySelector('[data-testid="complete-t1"]')).toBeTruthy();
    expect(el.textContent).toContain('Renew passport');

    // An error toast is shown, but with no working action to tap.
    const snackbar = el.querySelector('.snackbar');
    expect(snackbar?.textContent).toContain('Could not complete that task.');
    expect(el.querySelector('.snackbar__action')).toBeNull();
  });

  it('shows only the latest snackbar when a second action supersedes the first before the undo window elapses', () => {
    // No fake-timer machinery (jasmine.clock() or similar) exists elsewhere
    // in this spec file, and none is needed here: the assertions run well
    // inside the real 6s undo window, so the second action's setTimeout
    // simply replaces the first's synchronously, with no need to fast-forward
    // or wait out any timer.
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      tasks: {
        status: 'ok',
        items: [
          { id: 't1', title: 'Renew passport', due: '2026-09-05', overdue: false, notes: null },
          { id: 't2', title: 'Pay invoice', due: '2026-09-05', overdue: false, notes: null },
        ],
      },
    };
    const el = setup(api);

    (el.querySelector('[data-testid="dismiss-t1"]') as HTMLButtonElement).click();
    currentFixture.detectChanges();
    (el.querySelector('[data-testid="dismiss-t2"]') as HTMLButtonElement).click();
    currentFixture.detectChanges();

    const snackbars = el.querySelectorAll('.snackbar');
    expect(snackbars.length).toBe(1);
    expect(snackbars[0].textContent).toContain('Task hidden from Today.');
  });

  it('renders the mail sender and snippet on their own lines', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      mail: {
        status: 'ok',
        items: [
          { id: 'm1', from: 'Alice', subject: 'Lunch?', snippet: 'Are you free', receivedAt: '' },
        ],
      },
    };
    const el = setup(api);
    expect(el.querySelector('.mail__subject')?.textContent).toContain('Lunch?');
    expect(el.querySelector('.mail__snippet')?.textContent).toContain('Are you free');
  });

  it('shows an overflow line when there is more unread', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = { ...CONNECTED, mailHasMore: true };
    const el = setup(api);
    expect(el.textContent).toContain('More unread in Gmail');
  });
  it('renders read and archive controls on a mail row', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      mail: {
        status: 'ok',
        items: [{ id: 'm1', from: 'Alice', subject: 'Lunch?', snippet: 's', receivedAt: '' }],
      },
    };
    const el = setup(api);
    expect(el.querySelector('[data-testid="read-m1"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="archive-m1"]')).toBeTruthy();
  });

  it('removes the row and calls archive', () => {
    localStorage.removeItem(BRIEFING_CACHE_KEY);
    const api = new StubApi();
    api.briefing = {
      ...CONNECTED,
      mail: {
        status: 'ok',
        items: [{ id: 'm1', from: 'Alice', subject: 'Lunch?', snippet: 's', receivedAt: '' }],
      },
    };
    const el = setup(api);
    (el.querySelector('[data-testid="archive-m1"]') as HTMLButtonElement).click();
    expect(api.mailActions).toEqual([{ id: 'm1', action: 'archive' }]);
  });
});
