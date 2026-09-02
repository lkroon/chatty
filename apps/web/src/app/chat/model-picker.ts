import { Component, computed, inject } from '@angular/core';

import { ChatStore } from '../core/chat-store';

@Component({
  selector: 'app-model-picker',
  imports: [],
  template: `
    <label class="model-picker">
      <span class="sr-only">Model</span>
      <select
        [value]="store.selectedModelId()"
        (change)="onChange($event)"
        [disabled]="store.models().length === 0"
      >
        @for (model of store.models(); track model.id) {
          <option [value]="model.id">{{ model.label }}</option>
        }
      </select>
      @if (selectedModelCanSearch()) {
        <span class="model-picker__search-icon" title="This model can search the web" aria-hidden="true">
          🔍
        </span>
      }
    </label>
  `,
  styles: `
    .model-picker {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
    }

    select {
      font: inherit;
      padding: 0.4em 0.6em;
      border-radius: 6px;
      border: 1px solid var(--oc-border, #444);
      background: var(--oc-surface, #1e1e1e);
      color: inherit;
      max-width: 40vw;
    }

    .model-picker__search-icon {
      font-size: 0.95em;
      line-height: 1;
      opacity: 0.85;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class ModelPicker {
  protected readonly store = inject(ChatStore);

  /** True only when the currently selected model may actually receive the web_search/web_fetch tools right now. */
  protected readonly selectedModelCanSearch = computed(
    () => this.store.models().find((m) => m.id === this.store.selectedModelId())?.toolCapable ?? false,
  );

  protected onChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.store.selectModel(id);
  }
}
