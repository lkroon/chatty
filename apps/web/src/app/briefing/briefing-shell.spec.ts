import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { Briefing, GoogleConnectionStatus } from '@contracts';

import { BRIEFING_API, BriefingApi } from './briefing-api';
import { BriefingShell } from './briefing-shell';
import {
  BRIEFING_CACHE_KEY,
  itemFingerprint,
  writeBriefingCache,
} from '../core/briefing-cache';

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
      { id: 'e1', title: 'Standup', start: '2026-09-05T09:00:00+02:00', end: null, allDay: false, location: null },
    ],
  },
  tasks: { status: 'ok', items: [] },
  mail: { status: 'ok', items: [{ id: 'm1', from: 'Alice', subject: 'Lunch?', snippet: 's', receivedAt: '' }] },
  mailHasMore: false,
  pending: [],
  generatedAt: '2026-09-05T06:00:00.000Z',
};

class StubApi implements BriefingApi {
  briefing: Briefing = CONNECTED;
  status: GoogleConnectionStatus = { connected: true, scopes: [] };
  failBriefing = false;
  fullCalls = 0;
  itemCalls = 0;
  completed: string[] = [];

  getBriefing() {
    this.fullCalls++;
    return this.failBriefing ? throwError(() => new Error('boom')) : of(this.briefing);
  }
  getBriefingItems() {
    this.itemCalls++;
    const { summary, ...items } = this.briefing;
    return of(items);
  }
  completeTask(id: string) {
    this.completed.push(id);
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
    api.briefing = { ...CONNECTED, mail: { status: 'error', message: 'Could not read your mail.' } };
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
});
