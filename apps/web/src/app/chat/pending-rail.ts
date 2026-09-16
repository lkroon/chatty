import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A standing reminder, directly above the composer, that something the model
 * proposed is still unanswered. It carries no Confirm of its own — it points
 * at Today, which points at the card.
 *
 * The count is **this conversation's**, derived from the messages already on
 * screen; Today's badge is the one that counts every conversation. The copy
 * says "in this chat" for exactly that reason — the two numbers legitimately
 * differ, and an unlabelled count that disagrees with the badge above it reads
 * as a bug.
 *
 * It renders nothing at zero rather than saying "nothing waiting": a rail
 * that is always there stops being read, and this one has to still work on
 * the day it matters.
 */
@Component({
  selector: 'app-pending-rail',
  imports: [RouterLink],
  template: `
    @if (count() > 0) {
      <div class="rail">
        <span aria-hidden="true">⚠</span>
        <span
          ><strong>{{ count() }}</strong> {{ count() === 1 ? 'write' : 'writes' }} waiting in this
          chat</span
        >
        <a class="rail__go" routerLink="/">Review on Today</a>
      </div>
    }
  `,
  styles: `
    .rail {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0 0.7rem 0.4rem;
      padding: 0.4rem 0.5rem;
      border-radius: var(--oc-r);
      border: 1px solid var(--oc-accent);
      background: var(--oc-accent-soft);
      color: var(--oc-accent-ink);
      font-family: var(--font-meta);
      font-size: 0.75rem;
    }
    .rail strong {
      color: var(--oc-text);
    }
    .rail__go {
      margin-left: auto;
      flex-shrink: 0;
      /* 16px keeps iOS from zooming the page when this is tapped next to
         the composer. */
      font-family: var(--font-ui);
      font-size: 16px;
      font-weight: 600;
      padding: 0.2em 0.8em;
      border-radius: var(--oc-r);
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      text-decoration: none;
    }
  `,
})
export class PendingRail {
  /** Proposals still awaiting a decision. 0 renders nothing. */
  readonly count = input(0);
}
