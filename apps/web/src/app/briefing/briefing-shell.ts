import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AGENDA_DAY_COUNT, type Briefing, type BriefingEvent, type ProposalCard, type ProposalKind } from '@contracts';

import { itemFingerprint, readBriefingCache, writeBriefingCache } from '../core/briefing-cache';
import { renderMarkdownToHtml } from '../core/markdown';
import { ChattyLogo } from '../shared/chatty-logo';
import { ThemeToggle } from '../shared/theme-toggle';
import { TodayChatSwitch } from '../shared/today-chat-switch';
import { BRIEFING_API } from './briefing-api';
import { RealBriefingApi } from './real-briefing-api';

/** Foreground revalidation cadence. Mail and calendar move in minutes, not seconds. */
const REVALIDATE_INTERVAL_MS = 15 * 60 * 1000;

/** How long an undo stays offered. Long enough to notice a misfire on a phone. */
const UNDO_WINDOW_MS = 6000;

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
  imports: [NgTemplateOutlet, ChattyLogo, ThemeToggle, TodayChatSwitch],
  providers: [{ provide: BRIEFING_API, useClass: RealBriefingApi }],
  template: `
    <div class="shell">
      <header class="topbar">
        <span class="brand"><app-chatty-logo [size]="26" /></span>
        <app-today-chat-switch active="today" [pendingCount]="pendingCount()" />
        <div class="topbar__actions">
          <app-theme-toggle />
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
        </div>
      </header>

      <main class="body">
        @if (needsReconnect()) {
          <section class="card card--queue">
            <h2>Reconnect Google</h2>
            <p>
              Chatty needs one more permission before it can mark mail read or archive it from here.
              Nothing else is affected.
            </p>
            <a class="connect" href="/auth/google/connect">Reconnect Google</a>
          </section>
        }
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
              <p>
                Chatty builds this page from your calendar and mail, and can draft things back once
                you approve them.
              </p>
              <ul class="scope-list">
                <li><span aria-hidden="true">📅</span><span>Read today's events</span></li>
                <li>
                  <span aria-hidden="true">✉️</span
                  ><span>Read recent mail — subjects and previews only</span>
                </li>
                <li>
                  <span aria-hidden="true">✅</span
                  ><span>Create events, tasks and emails you confirm first</span>
                </li>
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
                  @for (event of todaysEvents(); track event.id) {
                    <div class="row">
                      <span class="row__time">{{
                        event.allDay ? 'All day' : formatTime(event.start)
                      }}</span>
                      <span class="row__title">{{ event.title }}</span>
                    </div>
                  } @empty {
                    <p class="hint">Nothing scheduled.</p>
                  }
                  <!--
                    Today in full, the days after it folded to a line each.
                    The line carries a count and the first titles, so a closed
                    day still answers "is there anything I need to know about
                    tomorrow" without being opened.
                  -->
                  @for (day of laterDays(); track day.date) {
                    <button
                      type="button"
                      class="fold"
                      [attr.data-testid]="'day-' + day.date"
                      [disabled]="!day.events.length"
                      [attr.aria-expanded]="day.events.length ? isDayOpen(day.date) : null"
                      (click)="toggleDay(day.date)"
                    >
                      <span class="fold__chev" aria-hidden="true">{{
                        day.events.length ? (isDayOpen(day.date) ? '▾' : '▸') : '·'
                      }}</span>
                      <span class="fold__label">{{ day.label }}</span>
                      <span class="fold__preview">{{ day.preview }}</span>
                      @if (day.events.length) {
                        <span class="fold__count">{{ day.events.length }}</span>
                      }
                    </button>
                    @if (isDayOpen(day.date)) {
                      @for (event of day.events; track event.id) {
                        <div class="row row--later">
                          <span class="row__time">{{
                            event.allDay ? 'All day' : formatTime(event.start)
                          }}</span>
                          <span class="row__title">{{ event.title }}</span>
                        </div>
                      }
                    }
                  }
                }
                @case ('error') {
                  <p class="hint">{{ b.calendar.message }}</p>
                }
              }
            </section>

            <section class="card">
              <h2>Tasks</h2>
              @switch (b.tasks.status) {
                @case ('ok') {
                  <!--
                    Two groups under one heading each, rather than a date on
                    every row: the heading is what tells you which kind of
                    task you are looking at, so only lateness stays per-row.
                  -->
                  @if (dueTasks().length) {
                    <div class="grouphead grouphead--now">
                      Due <span class="grouphead__count">· {{ dueTasks().length }}</span>
                    </div>
                    @for (task of dueTasks(); track task.id) {
                      <ng-container *ngTemplateOutlet="taskRow; context: { $implicit: task }" />
                    }
                  }
                  @if (undatedTasks().length) {
                    <div class="grouphead" [class.grouphead--ruled]="dueTasks().length">
                      No due date <span class="grouphead__count">· {{ undatedTasks().length }}</span>
                    </div>
                    @for (task of undatedTasks(); track task.id) {
                      <ng-container *ngTemplateOutlet="taskRow; context: { $implicit: task }" />
                    }
                  }
                  @if (!visibleTasks().length) {
                    <p class="hint">No tasks waiting.</p>
                  }
                }
                @case ('error') {
                  <p class="hint">{{ b.tasks.message }}</p>
                }
              }
            </section>

            <section class="card">
              <h2>Mail</h2>
              @switch (b.mail.status) {
                @case ('ok') {
                  @for (mail of visibleMail(); track mail.id) {
                    <div class="mail">
                      <span class="mail__body">
                        <span class="mail__subject">{{ mail.subject }}</span>
                        <span class="mail__meta">{{ mail.from }}</span>
                        @if (mail.snippet) {
                          <span class="mail__snippet">{{ mail.snippet }}</span>
                        }
                      </span>
                      <span class="mail__actions">
                        <button
                          type="button"
                          class="mail__action"
                          [attr.data-testid]="'read-' + mail.id"
                          (click)="markMailRead(mail.id)"
                          [attr.aria-label]="'Mark read: ' + mail.subject"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          class="mail__action"
                          [attr.data-testid]="'archive-' + mail.id"
                          (click)="archiveMail(mail.id)"
                          [attr.aria-label]="'Archive: ' + mail.subject"
                        >
                          ↓
                        </button>
                      </span>
                    </div>
                  } @empty {
                    <p class="hint">No unread mail.</p>
                  }
                }
                @case ('error') {
                  <p class="hint">{{ b.mail.message }}</p>
                }
              }
              @if (b.mailHasMore) {
                <p class="hint">More unread in Gmail.</p>
              }
            </section>
          }
        }
      </main>

      @if (undo(); as u) {
        <div class="snackbar" role="status">
          <span>{{ u.label }}</span>
          @if (u.restore) {
            <button type="button" class="snackbar__action" (click)="undoLast()">Undo</button>
          }
        </div>
      }
    </div>

    <!--
      One row, used by both task groups. A second copy of this markup is the
      only alternative, and the two would drift.
    -->
    <ng-template #taskRow let-task>
      <div class="task">
        <button
          type="button"
          class="task__tick"
          [attr.data-testid]="'complete-' + task.id"
          (click)="completeTask(task.id)"
          [attr.aria-label]="'Complete ' + task.title"
        >
          ○
        </button>
        <span class="task__body">
          <span class="task__title">{{ task.title }}</span>
          @if (task.overdue) {
            <span class="task__due">Overdue · {{ task.due }}</span>
          }
        </span>
        <button
          type="button"
          class="task__dismiss"
          [attr.data-testid]="'dismiss-' + task.id"
          (click)="dismissTask(task.id)"
          [attr.aria-label]="'Hide ' + task.title"
        >
          ×
        </button>
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      position: fixed;
      top: var(--app-offset-top, 0px);
      left: var(--app-offset-left, 0px);
      width: 100%;
      height: var(--app-height, 100dvh);
      background: var(--oc-bg);
      color: var(--oc-text);
    }
    .shell {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.7rem;
      padding-top: calc(0.45rem + env(safe-area-inset-top));
      background: var(--oc-surface);
      border-bottom: 1px solid var(--oc-border);
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .topbar__actions {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      margin-left: auto;
      flex-shrink: 0;
    }
    .refresh {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border-radius: var(--oc-r);
      border: 1px solid var(--oc-border);
      background: var(--oc-surface);
      color: var(--oc-text-muted);
      font-size: 18px;
      cursor: pointer;
    }
    .refresh:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.7rem;
      padding-bottom: calc(0.7rem + var(--kb-safe-bottom, 0px));
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .card {
      background: var(--oc-surface);
      border: 1px solid var(--oc-border);
      border-radius: var(--oc-r);
      box-shadow: var(--oc-shadow);
      padding: 0.65rem 0.8rem;
    }
    /* Mono rather than small caps: these label a machine-assembled section,
       and the times and counts under them are set the same way. */
    .card h2 {
      margin: 0 0 0.5rem;
      font-family: var(--font-meta);
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--oc-accent-ink);
    }
    .row {
      display: flex;
      gap: 0.6rem;
      padding: 0.3rem 0;
      align-items: baseline;
    }
    .row__time {
      flex-shrink: 0;
      font-family: var(--font-meta);
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
      color: var(--oc-text-muted);
    }
    .row__title {
      flex: 1;
      min-width: 0;
    }
    /* An opened day sits under its own line, indented so the eye can tell it
       from today's rows without a second heading. */
    .row--later {
      padding-left: 0.9rem;
      color: var(--oc-text-muted);
    }
    /* Mono, like the card headings: these label a group the app assembled. */
    .grouphead {
      display: flex;
      align-items: baseline;
      gap: 0.3rem;
      margin: 0.15rem 0;
      font-family: var(--font-meta);
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--oc-text-muted);
    }
    .grouphead--now {
      color: var(--oc-accent-ink);
    }
    .grouphead--ruled {
      border-top: 1px solid var(--oc-rule);
      padding-top: 0.55rem;
      margin-top: 0.5rem;
    }
    .grouphead__count {
      font-weight: 400;
      opacity: 0.8;
    }
    .fold {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      width: 100%;
      min-height: 44px;
      padding: 0.3rem 0;
      border: none;
      border-top: 1px solid var(--oc-rule);
      background: none;
      font: inherit;
      font-size: 0.9rem;
      text-align: left;
      color: var(--oc-text-muted);
      cursor: pointer;
    }
    .fold:disabled {
      cursor: default;
    }
    .fold__chev {
      flex-shrink: 0;
      width: 0.9rem;
      font-size: 0.75rem;
    }
    .fold__label {
      flex-shrink: 0;
      color: var(--oc-text);
    }
    .fold__preview {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fold__count {
      flex-shrink: 0;
      font-family: var(--font-meta);
      font-size: 0.72rem;
      font-variant-numeric: tabular-nums;
    }
    .hint {
      margin: 0;
      color: var(--oc-text-muted);
    }
    .connect {
      display: inline-flex;
      justify-content: center;
      width: 100%;
      padding: 0.8rem 1rem;
      border-radius: var(--oc-r);
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      font-weight: 600;
      text-decoration: none;
    }
    .connect-card {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      padding: 0.9rem 0.9rem;
    }
    .connect-card h2 {
      margin: 0;
      font-family: var(--font-ui);
      font-weight: 600;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
      color: var(--oc-text);
    }
    .connect-card p {
      margin: 0;
      line-height: 1.5;
    }
    .scope-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.9rem;
    }
    .scope-list li {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
    }
    .card--queue {
      border-color: var(--oc-accent);
      background: var(--oc-accent-soft);
    }
    .queue-item {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      padding: 0.3rem 0;
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
      font-family: var(--font-meta);
      font-size: 0.72rem;
      color: var(--oc-text-muted);
    }
    .queue-item__go {
      flex-shrink: 0;
      font-size: 16px;
      font-weight: 600;
      padding: 0.3em 0.9em;
      border-radius: var(--oc-r);
      border: none;
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      cursor: pointer;
    }
    .task {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      padding: 0.3rem 0;
      min-height: 44px;
    }
    .task__tick,
    .task__dismiss {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border-radius: var(--oc-r);
      border: none;
      background: none;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      color: var(--oc-text-muted);
    }
    .task__tick {
      color: var(--oc-accent);
    }
    .task__body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .task__title {
      overflow-wrap: anywhere;
    }
    .task__due {
      font-family: var(--font-meta);
      font-size: 0.72rem;
      color: var(--oc-error);
    }

    /* Stacked, not a single baseline row: a subject and a sender do not fit
       side by side on a phone, and the snippet was fetched and never shown. */
    .mail {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      padding: 0.45rem 0;
      min-height: 44px;
    }
    .mail__subject {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .mail__meta {
      font-family: var(--font-meta);
      font-size: 0.72rem;
      color: var(--oc-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mail__snippet {
      font-size: 0.85rem;
      color: var(--oc-text-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Overrides the column layout above: the row becomes body + actions, and
       .mail__body keeps the stacked subject/sender/snippet. */
    .mail {
      flex-direction: row;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .mail__body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .mail__actions {
      flex-shrink: 0;
      display: flex;
      gap: 0.15rem;
    }
    .mail__action {
      width: 44px;
      height: 44px;
      border: none;
      background: none;
      border-radius: var(--oc-r);
      font-size: 17px;
      line-height: 1;
      cursor: pointer;
      color: var(--oc-text-muted);
    }
    .mail__action:active {
      background: var(--oc-accent-soft);
      color: var(--oc-accent-ink);
    }

    .snackbar {
      position: absolute;
      left: 1rem;
      right: 1rem;
      bottom: calc(1rem + var(--kb-safe-bottom, 0px));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.8rem;
      padding: 0.6rem 0.8rem;
      border-radius: var(--oc-r);
      border: 1px solid var(--oc-border);
      background: var(--oc-surface-2);
      color: var(--oc-text);
      box-shadow: var(--oc-shadow);
    }
    .snackbar__action {
      border: none;
      background: none;
      color: var(--oc-accent-ink);
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      min-height: 44px;
      padding: 0 0.5rem;
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

    // Drives the reconnect card: a connection made before gmail.modify existed
    // keeps working for everything else, so this is a prompt, not an error.
    this.api
      .getGoogleStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => this.needsReconnect.set(status.connected && status.needsReconnect),
        error: () => this.needsReconnect.set(false),
      });

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
    this.destroyRef.onDestroy(() => this.clearUndo());
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
      this.api
        .getBriefing()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
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

    this.api
      .getBriefingItems()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
          this.api
            .getBriefing()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
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

  /**
   * Days after today that the agenda covers, each with the events on it.
   *
   * Built from the briefing's own date rather than the browser clock, and
   * always `AGENDA_DAY_COUNT - 1` entries long: a day with nothing on it
   * still gets a line, because "nothing tomorrow" is an answer.
   */
  protected readonly laterDays = computed<AgendaDay[]>(() => {
    const current = this.briefing();
    if (!current || current.calendar.status !== 'ok') {
      return [];
    }
    const events = current.calendar.items;
    const days: AgendaDay[] = [];
    for (let offset = 1; offset < AGENDA_DAY_COUNT; offset++) {
      const date = addDays(current.date, offset);
      const onDay = events.filter((event) => event.date === date);
      days.push({
        date,
        label: offset === 1 ? 'Tomorrow' : weekdayLabel(date),
        events: onDay,
        preview: onDay.length
          ? onDay
              .slice(0, 2)
              .map((event) => event.title)
              .join(', ')
          : 'Nothing scheduled',
      });
    }
    return days;
  });

  protected readonly todaysEvents = computed<BriefingEvent[]>(() => {
    const current = this.briefing();
    if (!current || current.calendar.status !== 'ok') {
      return [];
    }
    return current.calendar.items.filter((event) => event.date === current.date);
  });

  /**
   * Days the user opened. Deliberately not cached to disk: a day left open
   * yesterday says nothing about today, and Today should open the same way
   * every morning.
   */
  private readonly openDays = signal<string[]>([]);

  protected isDayOpen(date: string): boolean {
    return this.openDays().includes(date);
  }

  protected toggleDay(date: string): void {
    this.openDays.update((open) =>
      open.includes(date) ? open.filter((d) => d !== date) : [...open, date],
    );
  }

  /** Tasks with a due date — today's and anything late. */
  protected readonly dueTasks = computed(() =>
    this.visibleTasks().filter((task) => task.due !== null),
  );

  /** Tasks Google has no date for, which is most of what chat creates. */
  protected readonly undatedTasks = computed(() =>
    this.visibleTasks().filter((task) => task.due === null),
  );

  /** Tasks minus the ones dismissed locally. */
  protected readonly visibleTasks = computed(() => {
    const section = this.briefing()?.tasks;
    if (!section || section.status !== 'ok') {
      return [];
    }
    const hidden = new Set(this.dismissedTaskIds());
    return section.items.filter((task) => !hidden.has(task.id));
  });

  /** Ids acted on locally, so the row leaves before the server confirms. */
  private readonly actedMailIds = signal<string[]>([]);

  protected readonly needsReconnect = signal(false);

  protected readonly visibleMail = computed(() => {
    const section = this.briefing()?.mail;
    if (!section || section.status !== 'ok') {
      return [];
    }
    const hidden = new Set(this.actedMailIds());
    return section.items.filter((mail) => !hidden.has(mail.id));
  });

  protected markMailRead(id: string): void {
    this.actOnMail(id, 'Marked as read.', () => this.api.markMailRead(id));
  }

  protected archiveMail(id: string): void {
    this.actOnMail(id, 'Archived.', () => this.api.archiveMail(id));
  }

  /**
   * Optimistic, then reconciled. The local read-state flip is what keeps the
   * cache and Gmail agreeing without a round trip; the refresh afterwards is
   * what makes a failure visible rather than silently wrong.
   */
  private actOnMail(id: string, label: string, call: () => Observable<void>): void {
    this.actedMailIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
    this.showUndo(label, () => this.actedMailIds.update((ids) => ids.filter((x) => x !== id)));
    call()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.refresh(false),
        error: (err: Error) => {
          this.actedMailIds.update((ids) => ids.filter((x) => x !== id));
          if (err.message.includes('403')) {
            this.needsReconnect.set(true);
          }
          this.showUndo('Could not update that message.', null);
        },
      });
  }

  protected readonly undo = signal<{ label: string; restore: (() => void) | null } | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Optimistic: the row leaves immediately, and a failure puts it back with a
   * message. After a success the items are refetched rather than trusted —
   * completing a recurring task spawns its next occurrence, so the list
   * afterwards is not simply the list minus a row.
   */
  protected completeTask(id: string): void {
    this.hideTask(id, 'Task completed.', () =>
      this.dismissedTaskIds.update((ids) => ids.filter((x) => x !== id)),
    );
    this.api
      .completeTask(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.refresh(false),
        error: () => {
          this.dismissedTaskIds.update((ids) => ids.filter((x) => x !== id));
          this.persist();
          this.showUndo('Could not complete that task.', null);
        },
      });
  }

  /** Local only. Google Tasks has no discard, and delete has no undo. */
  protected dismissTask(id: string): void {
    this.hideTask(id, 'Task hidden from Today.', () =>
      this.dismissedTaskIds.update((ids) => ids.filter((x) => x !== id)),
    );
  }

  protected undoLast(): void {
    const current = this.undo();
    this.clearUndo();
    if (current?.restore) {
      current.restore();
      this.persist();
    }
  }

  private hideTask(id: string, label: string, restore: () => void): void {
    this.dismissedTaskIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
    this.persist();
    this.showUndo(label, restore);
  }

  private showUndo(label: string, restore: (() => void) | null): void {
    this.clearUndo();
    this.undo.set({ label, restore });
    this.undoTimer = setTimeout(() => this.undo.set(null), UNDO_WINDOW_MS);
  }

  private clearUndo(): void {
    if (this.undoTimer) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
    this.undo.set(null);
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

interface AgendaDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** "Tomorrow", or "Fri 18" for the days after it. */
  label: string;
  events: BriefingEvent[];
  /** The first titles on the day, so a closed line still says something. */
  preview: string;
}

/** Pure string arithmetic on a `YYYY-MM-DD`, so no zone is involved. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `2026-09-18` -> `Fri 18`. Noon, so no zone shift can move the weekday. */
function weekdayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  return `${weekday} ${Number(isoDate.slice(8, 10))}`;
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
