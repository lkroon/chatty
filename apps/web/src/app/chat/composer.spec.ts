import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import type { ChatEvent } from '@contracts';

import { CHAT_API, ChatApi } from '../core/chat-api';
import { ChatStore } from '../core/chat-store';
import { Composer } from './composer';

class StubChatApi implements ChatApi {
  listModels() {
    return of([]);
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

describe('Composer', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Composer>>;
  let store: ChatStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Composer],
      providers: [
        provideZonelessChangeDetection(),
        ChatStore,
        { provide: CHAT_API, useClass: StubChatApi },
      ],
    });
    fixture = TestBed.createComponent(Composer);
    fixture.detectChanges();
    store = TestBed.inject(ChatStore);
    spyOn(store, 'send');
  });

  function setPointer(kind: 'fine' | 'coarse'): void {
    spyOn(window, 'matchMedia').and.callFake(
      (query: string) =>
        ({
          matches: query.includes(kind),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
  }

  it('sends on Enter with a fine pointer (desktop)', () => {
    setPointer('fine');
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    textarea.dispatchEvent(event);

    expect(store.send).toHaveBeenCalledWith('hello');
  });

  it('does not send on Shift+Enter — inserts a newline instead', () => {
    setPointer('fine');
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
    textarea.dispatchEvent(event);

    expect(store.send).not.toHaveBeenCalled();
  });

  it('sends on Enter with a coarse pointer (touch) too', () => {
    setPointer('coarse');
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    textarea.dispatchEvent(event);

    expect(store.send).toHaveBeenCalledWith('hello');
  });

  it('does not send mid-composition — an IME Enter accepts a candidate', () => {
    setPointer('coarse');
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'hel';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // KeyboardEvent init has no isComposing in every browser's typings, so
    // set it on the instance the way the platform would.
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    textarea.dispatchEvent(event);

    expect(store.send).not.toHaveBeenCalled();
  });

  it('labels the on-screen keyboard return key as send', () => {
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    expect(textarea.getAttribute('enterkeyhint')).toBe('send');
  });

  it('sends via the submit button regardless of pointer type', () => {
    setPointer('coarse');
    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form: HTMLFormElement = fixture.nativeElement.querySelector('form.composer');
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(store.send).toHaveBeenCalledWith('hello');
  });
});
