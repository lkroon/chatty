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
    .proposal {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--oc-border, #dcece4);
      border-radius: 14px;
      background: var(--oc-surface, #fff);
      font-size: 0.9rem;
    }

    .proposal--settled {
      opacity: 0.85;
    }

    .proposal--failed {
      border-color: var(--oc-error, #ff6b6b);
    }

    .proposal__head {
      display: flex;
      align-items: center;
      gap: 0.5em;
      font-weight: 700;
    }

    .proposal__fields {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .proposal__field {
      display: flex;
      gap: 0.5em;
    }

    .proposal__field dt {
      flex: 0 0 4.5rem;
      color: var(--oc-text-muted, #6f7a76);
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
      color: var(--oc-text-muted, #6f7a76);
    }

    .proposal__expiry {
      margin: 0;
      font-size: 0.85em;
      color: var(--oc-text-muted, #6f7a76);
    }

    .proposal__link {
      color: var(--oc-accent-ink, #7a2c22);
    }

    .proposal__actions {
      display: flex;
      gap: 0.5rem;
    }

    .proposal__actions button {
      /* 16px: anything smaller makes iOS zoom the page on focus. */
      font-size: 16px;
      font-weight: 600;
      padding: 0.45em 1.1em;
      border-radius: 999px;
      border: 1px solid var(--oc-border, #dcece4);
      cursor: pointer;
    }

    .proposal__actions button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .proposal__confirm {
      background: var(--oc-accent, #ff6f59);
      color: #fff;
      border-color: transparent;
    }

    .proposal__discard {
      background: transparent;
      color: var(--oc-text-muted, #6f7a76);
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
      ? 'Expires today if you don\'t confirm.'
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
