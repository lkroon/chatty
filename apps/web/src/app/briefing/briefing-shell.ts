import { Component, inject, signal } from '@angular/core';
import type { Briefing } from '@contracts';

import { renderMarkdownToHtml } from '../core/markdown';
import { ChattyLogo } from '../shared/chatty-logo';
import { TodayChatSwitch } from '../shared/today-chat-switch';
import { BRIEFING_API } from './briefing-api';
import { RealBriefingApi } from './real-briefing-api';

/**
 * The daily overview, and the app's landing route. Sized to the visible
 * viewport like the chat shell — see core/viewport-fit.ts and styles.scss
 * for why <body> never scrolls.
 *
 * The top bar carries the brand mark and the switch, and nothing else. No
 * conversation drawer (there is no conversation here) and no model picker:
 * the summary is written by BRIEFING_MODEL, which is deliberately not the
 * chat model, so offering the chat picker here would be a control that
 * changes nothing on screen.
 */
@Component({
  selector: 'app-briefing-shell',
  imports: [ChattyLogo, TodayChatSwitch],
  providers: [{ provide: BRIEFING_API, useClass: RealBriefingApi }],
  template: `
    <div class="shell">
      <header class="topbar">
        <span class="brand"><app-chatty-logo [size]="26" /></span>
        <app-today-chat-switch active="today" />
      </header>

      <main class="body">
        @if (loading()) {
          <p class="hint">Loading your briefing…</p>
        } @else if (failed()) {
          <p class="hint">Couldn't load your briefing. Pull down to try again.</p>
        } @else if (briefing(); as b) {
          @if (b.calendar.status === 'not_connected') {
            <!--
              The first screen a new account sees, so it names each permission
              rather than saying "access to your Google account". The list
              must stay true to the scopes actually requested in google-oauth.ts
              — a line here for a permission the consent screen does not ask
              for is a lie the user finds out about later. The write plan adds
              its line when it adds its scopes.
            -->
            <section class="card connect-card">
              <h2>Connect Google</h2>
              <p>Chatty builds this page from your calendar and mail. It only reads.</p>
              <ul class="scope-list">
                <li><span aria-hidden="true">📅</span><span>Read today's events</span></li>
                <li><span aria-hidden="true">✉️</span><span>Read recent mail — subjects and previews only</span></li>
              </ul>
              <a class="connect" href="/auth/google/connect">Connect Google</a>
            </section>
          } @else {
            @if (b.summary) {
              <!--
                Unlike message-bubble.ts this component keeps Angular's default
                view encapsulation, so the tags renderMarkdownToHtml emits here
                are intentionally unstyled and inherit the body font. Do NOT
                copy message-bubble's ViewEncapsulation.None — that would leak
                every style in this file globally.
              -->
              <section class="card summary" [innerHTML]="renderedSummary()"></section>
            }

            <section class="card">
              <h2>Agenda</h2>
              @switch (b.calendar.status) {
                @case ('ok') {
                  @for (event of b.calendar.items; track event.id) {
                    <div class="row">
                      <span class="row__time">{{ event.allDay ? 'All day' : formatTime(event.start) }}</span>
                      <span class="row__title">{{ event.title }}</span>
                    </div>
                  } @empty {
                    <p class="hint">Nothing scheduled.</p>
                  }
                }
                @case ('error') {
                  <p class="hint">{{ b.calendar.message }}</p>
                }
              }
            </section>

            <section class="card">
              <h2>Mail</h2>
              @switch (b.mail.status) {
                @case ('ok') {
                  @for (mail of b.mail.items; track mail.id) {
                    <div class="row">
                      <span class="row__title">{{ mail.subject }}</span>
                      <span class="row__from">{{ mail.from }}</span>
                    </div>
                  } @empty {
                    <p class="hint">No unread mail.</p>
                  }
                }
                @case ('error') {
                  <p class="hint">{{ b.mail.message }}</p>
                }
              }
            </section>
          }
        }
      </main>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      top: var(--app-offset-top, 0px);
      left: var(--app-offset-left, 0px);
      width: 100%;
      height: var(--app-height, 100dvh);
      background: var(--oc-bg, #eef6f2);
      color: var(--oc-text, #23262b);
    }
    .shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .topbar {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.6rem 0.9rem;
      padding-top: calc(0.6rem + env(safe-area-inset-top));
      background: var(--oc-surface, #fff);
      border-bottom: 1px solid var(--oc-border, #dcece4);
      flex-shrink: 0;
    }
    .brand {
      display: flex; align-items: center; flex-shrink: 0;
    }
    .body {
      flex: 1; min-height: 0; overflow-y: auto;
      padding: 1rem;
      padding-bottom: calc(1rem + var(--kb-safe-bottom, 0px));
      display: flex; flex-direction: column; gap: 0.8rem;
    }
    .card {
      background: var(--oc-surface, #fff);
      border-radius: 18px; padding: 0.9rem 1rem;
    }
    .card h2 {
      margin: 0 0 0.6rem; font-size: 0.82rem; text-transform: uppercase;
      letter-spacing: 0.04em; color: var(--oc-text-muted, #6f7a76);
    }
    .row { display: flex; gap: 0.6rem; padding: 0.35rem 0; align-items: baseline; }
    .row__time { flex-shrink: 0; font-weight: 700; font-size: 0.82rem; color: var(--oc-accent-ink, #7a2c22); }
    .row__title { flex: 1; min-width: 0; }
    .row__from { font-size: 0.78rem; color: var(--oc-text-muted, #6f7a76); }
    .hint { margin: 0; color: var(--oc-text-muted, #6f7a76); }
    .connect {
      display: inline-flex; justify-content: center; width: 100%;
      padding: 0.8rem 1rem; border-radius: 999px;
      background: var(--oc-accent, #ff6f59); color: #fff;
      font-weight: 700; text-decoration: none;
    }
    .connect-card {
      display: flex; flex-direction: column; gap: 0.6rem;
      padding: 1.1rem 1rem;
    }
    .connect-card h2 {
      margin: 0;
      font-family: 'Baloo 2', sans-serif; font-weight: 700;
      font-size: 1.2rem; text-transform: none; letter-spacing: normal;
      color: var(--oc-accent-ink, #7a2c22);
    }
    .connect-card p { margin: 0; line-height: 1.5; }
    .scope-list {
      margin: 0; padding: 0; list-style: none;
      display: flex; flex-direction: column; gap: 0.35rem;
      font-size: 0.9rem;
    }
    .scope-list li { display: flex; gap: 0.5rem; align-items: baseline; }
  `,
})
export class BriefingShell {
  private readonly api = inject(BRIEFING_API);

  protected readonly briefing = signal<Briefing | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  constructor() {
    this.api.getBriefing().subscribe({
      next: (briefing) => {
        this.briefing.set(briefing);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected renderedSummary(): string {
    return renderMarkdownToHtml(this.briefing()?.summary ?? '');
  }

  /** `2026-09-05T09:00:00+02:00` -> `09:00`. The offset is already the user's zone. */
  protected formatTime(iso: string | null): string {
    if (!iso) {
      return '';
    }
    const match = /T(\d{2}:\d{2})/.exec(iso);
    return match ? match[1] : '';
  }
}
