import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { Briefing, GoogleConnectionStatus } from '@contracts';

import { BRIEFING_API, BriefingApi } from './briefing-api';
import { BriefingShell } from './briefing-shell';

const CONNECTED: Briefing = {
  date: '2026-09-05',
  timeZone: 'Europe/Amsterdam',
  summary: 'A quiet day.',
  calendar: {
    status: 'ok',
    items: [
      { id: 'e1', title: 'Standup', start: '2026-09-05T09:00:00+02:00', end: null, allDay: false, location: null },
    ],
  },
  mail: { status: 'ok', items: [{ id: 'm1', from: 'Alice', subject: 'Lunch?', snippet: 's', receivedAt: '' }] },
  generatedAt: '2026-09-05T06:00:00.000Z',
};

class StubApi implements BriefingApi {
  briefing: Briefing = CONNECTED;
  status: GoogleConnectionStatus = { connected: true, scopes: [] };
  failBriefing = false;
  getBriefing() {
    return this.failBriefing ? throwError(() => new Error('boom')) : of(this.briefing);
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
});
