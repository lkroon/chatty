import { Component, computed, inject } from '@angular/core';

import { ChatStore } from '../core/chat-store';

@Component({
  selector: 'app-model-picker',
  imports: [],
  template: `
    <label class="model-picker">
      <span class="sr-only">Model</span>
      <!--
        The selection lives on the <option>s, not as [value] on the <select>.
        Angular applies an element's own property bindings before it creates
        the embedded views inside it, so [value] here would be assigned while
        the list is still empty — a no-op the browser answers by falling back
        to whatever option renders first. The picker then showed a model the
        store had not selected, which is how the default looked broken even
        though the store had chosen correctly.
      -->
      <select (change)="onChange($event)" [disabled]="store.models().length === 0">
        @for (model of store.models(); track model.id) {
          <option [value]="model.id" [selected]="model.id === store.selectedModelId()">
            {{ model.label }}
          </option>
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
      /* Shrinks rather than pushing itself out of the top bar on a narrow
         phone — the model picker has to stay reachable at all times. */
      min-width: 0;
      flex-shrink: 1;
      gap: 0.35em;
      background: var(--oc-surface, #fff);
      border: 1px solid var(--oc-border, #dcece4);
      border-radius: 999px;
      padding: 0.3em 0.7em 0.3em 0.5em;
    }

    select {
      /* 16px, like the composer's textarea: anything smaller makes iOS
         Safari zoom the page in when the control takes focus, which pushes
         the rest of the top bar off screen. */
      font: 600 16px 'Plus Jakarta Sans', sans-serif;
      border: none;
      background: none;
      color: var(--oc-accent-ink, #7a2c22);
      min-width: 0;
      max-width: 45vw;
      text-overflow: ellipsis;
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
