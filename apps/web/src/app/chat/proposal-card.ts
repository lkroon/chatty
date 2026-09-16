import { Component, computed, input, output } from '@angular/core';
import type { ProposalCard as ProposalCardModel } from '@contracts';

const ICONS: Record<ProposalCardModel['kind'], string> = {
  calendar_event: '📅',
  task: '✅',
  email: '✉️',
};

const DONE_LABELS: Record<ProposalCardModel['kind'], string> = {
  calendar_event: 'Added to your calendar',
  task: 'Added to your tasks',
  email: 'Sent',
};

/**
 * One proposed write, with the buttons that are the only way it ever happens.
 *
 * The component decides nothing about the lifecycle: `confirmable`, the
 * status and the error all come from the server, built from the same row the
 * confirm endpoint will execute. It emits an intent and renders what comes
 * back — deliberately, so the rules cannot drift between the two.
 *
 * The class is named after the component; the contract type is imported as
 * `ProposalCardModel` (the same pattern as ToolChip / ToolCallChip).
 */
@Component({
  selector: 'app-proposal-card',
  imports: [],
  template: `
    <section
      class="proposal"
      [attr.id]="'proposal-' + card().id"
      [class.proposal--settled]="!card().confirmable"
      [class.proposal--failed]="card().status === 'failed'"
    >
      <header class="proposal__head">
        <span class="proposal__icon" aria-hidden="true">{{ icon() }}</span>
        <span class="proposal__title">{{ card().title }}</span>
      </header>

      <dl class="proposal__fields">
        @for (field of card().fields; track field.label) {
          <div class="proposal__field">
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value }}</dd>
          </div>
        }
      </dl>

      @if (statusLine()) {
        <p class="proposal__status">{{ statusLine() }}</p>
      }

      @if (expiryLine()) {
        <p class="proposal__expiry">{{ expiryLine() }}</p>
      }

      @if (card().link) {
        <p>
          <a class="proposal__link" [href]="card().link" target="_blank" rel="noopener noreferrer">
            Open in Google
          </a>
        </p>
      }

      @if (card().confirmable) {
        <div class="proposal__actions">
          <button
            type="button"
            class="proposal__confirm"
            [disabled]="busy()"
            (click)="confirmed.emit()"
          >
            {{ card().status === 'failed' ? 'Try again' : 'Confirm' }}
          </button>
          <button
            type="button"
            class="proposal__discard"
            [disabled]="busy()"
            (click)="discarded.emit()"
          >
            Discard
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    /* Raised, and the only thing in the thread with an accent edge: a write
       waiting on a decision is the one card that must not be skimmed past. */
    .proposal {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--oc-border);
      border-left: 2px solid var(--oc-accent);
      border-radius: var(--oc-r);
      background: var(--oc-surface);
      box-shadow: var(--oc-shadow);
      font-size: 0.9rem;
    }

    .proposal--settled {
      opacity: 0.85;
      border-left-color: var(--oc-rule);
    }

    .proposal--failed {
      border-color: var(--oc-error);
      border-left-color: var(--oc-error);
    }

    .proposal__head {
      display: flex;
      align-items: center;
      gap: 0.5em;
      font-weight: 600;
      color: var(--oc-accent-ink);
    }

    .proposal__fields {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .proposal__field {
      display: flex;
      gap: 0.5em;
    }

    .proposal__field dt {
      flex: 0 0 4.5rem;
      font-family: var(--font-meta);
      font-size: 0.8em;
      color: var(--oc-text-muted);
    }

    .proposal__field dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
      /* The server sends the email body in full and never truncates it, so a
         long message scrolls inside the card rather than being cut short or
         pushing the Confirm button off the screen. pre-wrap keeps the line
         breaks the user is about to send. */
      white-space: pre-wrap;
      max-height: 11rem;
      overflow-y: auto;
    }

    .proposal__status {
      margin: 0;
      color: var(--oc-text-muted);
    }

    .proposal__expiry {
      margin: 0;
      font-family: var(--font-meta);
      font-size: 0.78em;
      color: var(--oc-text-muted);
    }

    .proposal__link {
      color: var(--oc-accent-ink);
    }

    .proposal__actions {
      display: flex;
      gap: 0.5rem;
    }

    .proposal__actions button {
      /* 16px: anything smaller makes iOS zoom the page on focus. */
      font-family: var(--font-ui);
      font-size: 16px;
      font-weight: 600;
      padding: 0.4em 1.1em;
      border-radius: var(--oc-r);
      border: 1px solid var(--oc-border);
      cursor: pointer;
    }

    .proposal__actions button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .proposal__confirm {
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      border-color: transparent;
    }

    .proposal__discard {
      background: transparent;
      color: var(--oc-text-muted);
    }
  `,
})
export class ProposalCard {
  readonly card = input.required<ProposalCardModel>();
  /** True while a confirm/discard for this card is in flight. */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly discarded = output<void>();

  protected readonly icon = computed(() => ICONS[this.card().kind]);

  /**
   * "Expires Monday", or "Expires today" inside the last 24 hours. A weekday
   * name is what a person actually reasons about over a two-day window; a
   * date would be precise and useless. Empty for anything without a
   * deadline, so the paragraph disappears rather than reading "Expires —".
   */
  protected readonly expiryLine = computed(() => {
    const expiresAt = this.card().expiresAt;
    if (!expiresAt) {
      return '';
    }
    const deadline = new Date(expiresAt);
    const now = new Date();
    const sameDay = deadline.toDateString() === now.toDateString();
    return sameDay
      ? "Expires today if you don't confirm."
      : `Expires ${deadline.toLocaleDateString(undefined, { weekday: 'long' })} if you don't confirm.`;
  });

  protected readonly statusLine = computed(() => {
    const card = this.card();
    switch (card.status) {
      case 'pending':
        return '';
      case 'executing':
        return 'Working…';
      case 'executed':
        return DONE_LABELS[card.kind];
      case 'discarded':
        return 'Discarded';
      case 'expired':
        return 'Expired — ask again if you still want this.';
      case 'failed':
        return card.error ?? 'That did not go through.';
      default:
        return '';
    }
  });
}
