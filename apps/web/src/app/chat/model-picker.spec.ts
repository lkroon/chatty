import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import type { ChatEvent, Model } from '@contracts';

import { CHAT_API, ChatApi } from '../core/chat-api';
import { ChatStore } from '../core/chat-store';
import { ModelPicker } from './model-picker';

class StubChatApi implements ChatApi {
  models: Model[] = [];
  listModels() {
    return of(this.models);
  }
  listConversations() {
    return of([]);
  }
  getConversation() {
    return of({ id: 'x', title: 'x', messages: [] });
  }
  deleteConversation() {
    return of(undefined);
  }
  sendChat() {
    return of<ChatEvent>();
  }
}

describe('ModelPicker', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ModelPicker>>;
  let api: StubChatApi;

  function setup(models: Model[]): void {
    localStorage.removeItem('oc-model'); // isolate from any stored selection left by another spec
    api = new StubChatApi();
    api.models = models;
    TestBed.configureTestingModule({
      imports: [ModelPicker],
      providers: [provideZonelessChangeDetection(), ChatStore, { provide: CHAT_API, useValue: api }],
    });
    fixture = TestBed.createComponent(ModelPicker);
    fixture.detectChanges();
  }

  it('shows the search icon when the selected (default = first) model is toolCapable', () => {
    setup([
      { id: 'glm-5.3', label: 'glm-5.3', family: 'glm', toolCapable: true },
      { id: 'other', label: 'other', family: 'x', toolCapable: false },
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.model-picker__search-icon')).not.toBeNull();
  });

  it('hides the search icon when the selected model is not toolCapable', () => {
    setup([{ id: 'other', label: 'other', family: 'x', toolCapable: false }]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.model-picker__search-icon')).toBeNull();
  });

  it('hides the search icon when toolCapable is absent from the model entirely', () => {
    setup([{ id: 'other', label: 'other', family: 'x' }]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.model-picker__search-icon')).toBeNull();
  });

  it('toggles the icon when the selection changes to a different model', () => {
    setup([
      { id: 'a', label: 'a', family: 'x', toolCapable: false },
      { id: 'b', label: 'b', family: 'x', toolCapable: true },
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.model-picker__search-icon')).toBeNull();

    const select: HTMLSelectElement = el.querySelector('select')!;
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(el.querySelector('.model-picker__search-icon')).not.toBeNull();
  });
});
