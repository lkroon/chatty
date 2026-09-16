import { Component, inject } from '@angular/core';

import { Theme } from '../core/theme';

/**
 * Day/night, as one button rather than a three-way control: the third state
 * ('system') is what the app starts in, and it is not something anyone asks
 * for by name — they ask for the light one or the dark one.
 */
@Component({
  selector: 'app-theme-toggle',
  imports: [],
  template: `
    <button
      type="button"
      class="theme-toggle"
      [attr.aria-label]="theme.resolved() === 'dark' ? 'Switch to day' : 'Switch to night'"
      (click)="theme.toggle()"
    >
      @if (theme.resolved() === 'dark') {
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        >
          <circle cx="10" cy="10" r="3.6" />
          <path
            d="M10 2v1.8M10 16.2V18M18 10h-1.8M3.8 10H2M15.7 4.3l-1.3 1.3M5.6 14.4l-1.3 1.3M15.7 15.7l-1.3-1.3M5.6 5.6L4.3 4.3"
          />
        </svg>
      } @else {
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
        >
          <path d="M16.5 12.6A7 7 0 017.4 3.5a7 7 0 109.1 9.1z" />
        </svg>
      }
    </button>
  `,
  styles: `
    .theme-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border-radius: var(--oc-r);
      border: 1px solid var(--oc-border);
      background: var(--oc-surface);
      color: var(--oc-text-muted);
      cursor: pointer;
    }

    .theme-toggle svg {
      width: 18px;
      height: 18px;
    }

    .theme-toggle:active {
      background: var(--oc-accent-soft);
      color: var(--oc-accent-ink);
    }
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(Theme);
}
