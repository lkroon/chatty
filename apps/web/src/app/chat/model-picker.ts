import { Component, computed, inject } from '@angular/core';

import { ChatStore } from '../core/chat-store';

@Component({
  selector: 'app-model-picker',
  imports: [],
  template: `
    <label class="model-picker">
      <span class="sr-only">Model</span>
      <!--
        The label is drawn as text and the <select> sits invisibly on top of
        it. The native control still opens the native list, but the size the
        user reads is ours rather than the one iOS forces on the control
        itself — see the font-size note on the select below.
      -->
      <span class="model-picker__value" aria-hidden="true">{{ selectedModelLabel() }}</span>
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
        <span
          class="model-picker__search-icon"
          title="This model can search the web"
          aria-hidden="true"
        >
          🔍
        </span>
      }
    </label>
  `,
  styles: `
    .model-picker {
      position: relative;
      display: inline-flex;
      align-items: center;
      /* Shrinks rather than pushing itself out of the top bar on a narrow
         phone — the model picker has to stay reachable at all times. */
      min-width: 0;
      flex-shrink: 1;
      gap: 0.35rem;
      background: var(--oc-surface-2);
      border: 1px solid var(--oc-border);
      border-radius: var(--oc-r);
      padding: 0.24rem 0.6rem;
    }

    /* Set like the Today/Chat switch beside it: same mono face, same size,
       same weight, so the top bar reads as one row of controls. */
    .model-picker__value {
      font-family: var(--font-meta);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--oc-text);
      min-width: 0;
      max-width: 45vw;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    select {
      /* Covers the label it sits on, invisibly: the native list still opens
         from a tap anywhere on the control, and the text the user reads is
         the span above rather than this. */
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
      /* 16px, like the composer's textarea: anything smaller makes iOS
         Safari zoom the page in when the control takes focus, which pushes
         the rest of the top bar off screen. Invisible, so it costs nothing
         to keep it at the size iOS wants. */
      font-family: var(--font-meta);
      font-size: 16px;
      font-weight: 500;
      border: none;
      background: none;
      color: var(--oc-text);
    }

    /* The select is transparent, so its focus ring would be too. */
    select:focus-visible + .model-picker__value,
    .model-picker:focus-within {
      outline: 2px solid var(--oc-accent);
      outline-offset: 1px;
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

  /** What the picker displays — a placeholder until the model list lands. */
  protected readonly selectedModelLabel = computed(
    () =>
      this.store.models().find((m) => m.id === this.store.selectedModelId())?.label ?? 'Model',
  );

  /** True only when the currently selected model may actually receive the web_search/web_fetch tools right now. */
  protected readonly selectedModelCanSearch = computed(
    () =>
      this.store.models().find((m) => m.id === this.store.selectedModelId())?.toolCapable ?? false,
  );

  protected onChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.store.selectModel(id);
  }
}
