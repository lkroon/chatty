import { Component, computed, input, signal } from '@angular/core';
import type { ToolCallChip } from '@contracts';

/**
 * Collapsed-by-default row for one tool call: an icon, the human `label`,
 * and a result count. Tapping expands to the `sources` as external links.
 * `running` shows a spinner and is not expandable. `failed` is muted, not
 * red — a failed lookup is normal, not an error state.
 */
@Component({
  selector: 'app-tool-chip',
  imports: [],
  template: `
    <div
      class="tool-chip"
      [class.tool-chip--running]="chip().status === 'running'"
      [class.tool-chip--failed]="chip().status === 'failed'"
      [class.tool-chip--expandable]="expandable()"
      (click)="toggle()"
    >
      <span class="tool-chip__icon">
        @if (chip().status === 'running') {
          <span class="spinner" aria-hidden="true"></span>
        } @else if (chip().name === 'web_search') {
          🔍
        } @else {
          🔗
        }
      </span>
      <span class="tool-chip__label">{{ chip().label }}</span>
      @if (expandable()) {
        <span class="tool-chip__count">{{ chip().sources.length }}</span>
      }
    </div>
    @if (expanded() && expandable()) {
      <ul class="tool-chip__sources">
        @for (source of chip().sources; track source.url) {
          <li>
            <a [href]="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .tool-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      padding: 0.32em 0.7em;
      border-radius: 999px;
      background: var(--oc-yellow, #f7b733);
      font-weight: 600;
      font-size: 0.78em;
      color: #5c3c00;
      max-width: fit-content;
    }

    .tool-chip--expandable {
      cursor: pointer;
    }

    .tool-chip--expandable:hover {
      filter: brightness(0.97);
    }

    .tool-chip--running {
      background: var(--oc-surface, #fff);
      border: 1px solid var(--oc-border, #dcece4);
      color: var(--oc-text-muted, #6f7a76);
    }

    .tool-chip--failed {
      background: var(--oc-surface, #fff);
      border: 1px solid var(--oc-border, #dcece4);
      color: var(--oc-text-muted, #6f7a76);
    }

    .tool-chip__count {
      opacity: 0.75;
      font-size: 0.9em;
    }

    .spinner {
      display: inline-block;
      width: 0.8em;
      height: 0.8em;
      border-radius: 50%;
      border: 2px solid var(--oc-border, #dcece4);
      border-top-color: var(--oc-accent, #ff6f59);
      animation: tool-chip-spin 0.7s linear infinite;
    }

    @keyframes tool-chip-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .tool-chip__sources {
      list-style: none;
      margin: 0.3em 0 0;
      padding: 0 0 0 1.4em;
      font-size: 0.85em;
      color: var(--oc-text-muted, #6f7a76);
    }

    .tool-chip__sources a {
      color: var(--oc-accent-ink, #7a2c22);
    }
  `,
})
export class ToolChip {
  readonly chip = input.required<ToolCallChip>();

  private readonly expandedState = signal(false);

  protected readonly expandable = computed(
    () => this.chip().status !== 'running' && this.chip().sources.length > 0,
  );
  protected readonly expanded = computed(() => this.expandable() && this.expandedState());

  protected toggle(): void {
    if (!this.expandable()) {
      return;
    }
    this.expandedState.update((v) => !v);
  }
}
