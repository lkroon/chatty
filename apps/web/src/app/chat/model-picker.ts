import { Component, inject } from '@angular/core';

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
    </label>
  `,
  styles: `
    .model-picker {
      display: inline-flex;
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

  protected onChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.store.selectModel(id);
  }
}
