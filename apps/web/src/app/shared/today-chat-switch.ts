import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The two halves of the app, in the order they are used: the day first, then
 * the conversation about it. Presentational — it owns no state and emits
 * nothing; each screen passes its own `active` and its own `pendingCount`,
 * because the two counts come from different places (Today reads the
 * briefing's pending list, chat reads its loaded messages) and neither
 * screen can see the other's.
 *
 * Replaces the wordmark in chat's top bar rather than sitting beside it:
 * on a 375pt screen the wordmark is already hidden under 400px, so the row
 * has exactly this much room and no more.
 */
@Component({
  selector: 'app-today-chat-switch',
  imports: [RouterLink],
  template: `
    <nav class="switch" aria-label="Today or chat">
      <a
        routerLink="/"
        class="switch__half"
        [class.switch__half--on]="active() === 'today'"
        [attr.aria-current]="active() === 'today' ? 'page' : null"
        >Today</a
      >
      <a
        routerLink="/chat"
        class="switch__half"
        [class.switch__half--on]="active() === 'chat'"
        [attr.aria-current]="active() === 'chat' ? 'page' : null"
        >Chat
        @if (pendingCount() > 0) {
          <span class="badge" [attr.aria-label]="pendingCount() + ' waiting on you'">{{
            pendingCount()
          }}</span>
        }
      </a>
    </nav>
  `,
  styles: `
    .switch {
      display: inline-flex;
      padding: 2px;
      border-radius: var(--oc-r-lg);
      background: var(--oc-surface-2);
      border: 1px solid var(--oc-border);
      flex-shrink: 0;
    }
    .switch__half {
      display: inline-flex;
      align-items: center;
      padding: 0.24rem 0.7rem;
      border-radius: var(--oc-r);
      font-family: var(--font-meta);
      font-size: 0.75rem;
      font-weight: 500;
      text-decoration: none;
      color: var(--oc-text-muted);
    }
    .switch__half--on {
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      font-weight: 600;
    }
    .badge {
      display: inline-block;
      margin-left: 0.35em;
      min-width: 1.05em;
      padding: 0 0.3em;
      border-radius: 999px;
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      font-size: 0.68em;
      line-height: 1.55;
      text-align: center;
    }
    /* On the active half the badge sits on the accent itself, so it swaps
       the two colours rather than disappearing into its own background. */
    .switch__half--on .badge {
      background: var(--oc-on-accent);
      color: var(--oc-accent);
    }
  `,
})
export class TodayChatSwitch {
  readonly active = input.required<'today' | 'chat'>();
  /** Proposals still waiting on the user. 0 hides the badge entirely. */
  readonly pendingCount = input(0);
}
