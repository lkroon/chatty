import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { Briefing, ProposalCard, ProposalKind } from '@contracts';

import {
  itemFingerprint,
  readBriefingCache,
  writeBriefingCache,
} from '../core/briefing-cache';
import { renderMarkdownToHtml } from '../core/markdown';
import { ChattyLogo } from '../shared/chatty-logo';
import { TodayChatSwitch } from '../shared/today-chat-switch';
import { BRIEFING_API } from './briefing-api';
import { RealBriefingApi } from './real-briefing-api';

/** Foreground revalidation cadence. Mail and calendar move in minutes, not seconds. */
const REVALIDATE_INTERVAL_MS = 15 * 60 * 1000;

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
        <app-today-chat-switch active="today" [pendingCount]="pendingCount()" />
        <button
          type="button"
          class="refresh"
          data-testid="refresh"
          [disabled]="refreshing()"
          (click)="refresh(true)"
          aria-label="Refresh"
        >
          {{ refreshing() ? '…' : '↻' }}
        </button>
      </header>

      <main class="body">
        @if (loading()) {
          <p class="hint">Loading your briefing…</p>
        } @else if (failed()) {
          <p class="hint">Couldn't load your briefing. Tap ↻ to try again.</p>
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
              <p>Chatty builds this page from your calendar and mail, and can draft things back once you approve them.</p>
              <ul class="scope-list">
                <li><span aria-hidden="true">📅</span><span>Read today's events</span></li>
                <li><span aria-hidden="true">✉️</span><span>Read recent mail — subjects and previews only</span></li>
                <li><span aria-hidden="true">✅</span><span>Create events, tasks and emails you confirm first</span></li>
              </ul>
              <a class="connect" href="/auth/google/connect">Connect Google</a>
              <p class="hint">Nothing is written to Google until you tap Confirm on a card.</p>
            </section>
          } @else {
            @if (b.pending.length) {
              <section class="card card--queue">
                <h2>Waiting on you · {{ b.pending.length }}</h2>
                @for (item of b.pending; track item.id) {
                  <div class="queue-item">
                    <span class="queue-item__kind" aria-hidden="true">{{ icon(item.kind) }}</span>
                    <span class="queue-item__body">
                      {{ item.title }}
                      <span class="queue-item__meta">{{ item.fields[0]?.value }}</span>
                    </span>
                    @if (item.conversationId) {
                      <button type="button" class="queue-item__go" (click)="review(item)">
                        Review
                      </button>
                    }
                  </div>
                }
              </section>
            }
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
    .refresh {
      flex-shrink: 0;
      margin-left: auto;
      width: 44px; height: 44px;
      border-radius: 999px;
      border: 1px solid var(--oc-border, #dcece4);
      background: var(--oc-surface, #fff);
      color: var(--oc-accent-ink, #7a2c22);
      font-size: 18px;
      cursor: pointer;
    }
    .refresh:disabled { opacity: 0.5; cursor: default; }
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
    .card--queue {
      border: 1px solid var(--oc-accent, #ff6f59);
    }
    .queue-item {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      padding: 0.35rem 0;
    }
    .queue-item__kind {
      flex-shrink: 0;
    }
    .queue-item__body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .queue-item__meta {
      font-size: 0.78rem;
      color: var(--oc-text-muted, #6f7a76);
    }
    .queue-item__go {
      flex-shrink: 0;
      font-size: 16px;
      font-weight: 700;
      padding: 0.3em 0.9em;
      border-radius: 999px;
      border: none;
      background: var(--oc-accent, #ff6f59);
      color: #fff;
      cursor: pointer;
    }
  `,
})
export class BriefingShell {
  private readonly api = inject(BRIEFING_API);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly briefing = signal<Briefing | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly pendingCount = computed(() => this.briefing()?.pending.length ?? 0);

  /** Ids the user dismissed from Today. Local only — see briefing-cache.ts. */
  protected readonly dismissedTaskIds = signal<string[]>([]);

  /** The fingerprint the current summary was written for. */
  private summaryFingerprint = '';

  constructor() {
    const today = todayIsoInLocalZone();
    const cached = readBriefingCache(today);

    if (cached) {
      this.briefing.set({ ...cached.items, summary: cached.summary });
      this.summaryFingerprint = cached.summaryFingerprint;
      this.dismissedTaskIds.set(cached.dismissedTaskIds);
      this.loading.set(false);
      // Warm: the screen is already painted, so catch up on items alone.
      this.refresh(false);
    } else {
      this.refresh(true);
    }

    // Timers are throttled in a background tab and an installed iOS PWA is
    // suspended outright, so the interval alone would not fire. Focus and
    // visibility are what actually deliver a fresh Today on a phone.
    const onWake = () => {
      if (document.visibilityState === 'visible') {
        this.refresh(false);
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    const timer = setInterval(onWake, REVALIDATE_INTERVAL_MS);

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      clearInterval(timer);
    });
  }

  /**
   * `full` = the user asked. Items are always refetched; the summary is
   * regenerated only on an explicit refresh AND only when the item set
   * actually changed, because that is the one call that costs a model.
   */
  protected refresh(full: boolean): void {
    if (this.refreshing()) {
      return;
    }
    this.refreshing.set(true);

    if (full && !this.briefing()) {
      this.api.getBriefing().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (briefing) => {
          const { summary, ...items } = briefing;
          this.summaryFingerprint = itemFingerprint(items);
          this.briefing.set(briefing);
          this.loading.set(false);
          this.failed.set(false);
          this.refreshing.set(false);
          this.persist();
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
          this.refreshing.set(false);
        },
      });
      return;
    }

    this.api.getBriefingItems().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => {
        const fingerprint = itemFingerprint(items);
        const staleSummary = full && fingerprint !== this.summaryFingerprint;
        // Silent swap: no badge, no confirmation. Nothing is lost by simply
        // showing the newer data.
        this.briefing.set({ ...items, summary: this.briefing()?.summary ?? '' });
        this.loading.set(false);
        this.failed.set(false);
        this.persist();

        if (!staleSummary) {
          this.refreshing.set(false);
          return;
        }
        this.api.getBriefing().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (briefing) => {
            const { summary, ...fresh } = briefing;
            this.summaryFingerprint = itemFingerprint(fresh);
            this.briefing.set(briefing);
            this.refreshing.set(false);
            this.persist();
          },
          error: () => this.refreshing.set(false),
        });
      },
      error: () => {
        if (!this.briefing()) {
          this.failed.set(true);
        }
        this.loading.set(false);
        this.refreshing.set(false);
      },
    });
  }

  private persist(): void {
    const current = this.briefing();
    if (!current) {
      return;
    }
    const { summary, ...items } = current;
    writeBriefingCache({
      items,
      summary,
      summaryFingerprint: this.summaryFingerprint,
      dismissedTaskIds: this.dismissedTaskIds(),
      cachedAt: Date.now(),
    });
  }

  protected renderedSummary(): string {
    return renderMarkdownToHtml(this.briefing()?.summary ?? '');
  }

  protected icon(kind: ProposalKind): string {
    return { calendar_event: '📅', task: '✅', email: '✉️' }[kind];
  }

  /**
   * Opens the card, rather than acting on it. Today knows which conversation
   * the proposal was made in; chat-shell reads these two params and scrolls
   * to the card. Deliberately not a Confirm button: one implementation of the
   * gate, in one place, is what makes "the card and the executed action are
   * the same thing" checkable.
   */
  protected review(card: ProposalCard): void {
    if (!card.conversationId) {
      // The conversation was deleted while this proposal was still pending
      // (the column is ON DELETE SET NULL). There is no card to jump to, so
      // the template hides the button rather than navigating nowhere.
      return;
    }
    void this.router.navigate(['/chat'], {
      queryParams: { conversation: card.conversationId, proposal: card.id },
    });
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

/**
 * Today's date as the browser sees it, only ever used to decide whether a
 * cached briefing is from another day. The authoritative date is the one the
 * server put on the payload, in BRIEFING_TIMEZONE.
 */
function todayIsoInLocalZone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
