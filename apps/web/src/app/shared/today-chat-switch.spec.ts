import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { TodayChatSwitch } from './today-chat-switch';

describe('TodayChatSwitch', () => {
  // resetTestingModule() is load-bearing: two of the specs below call setup()
  // twice, and Angular throws "Cannot configure the test module when the test
  // module has already been instantiated" if you configure after createComponent
  // without resetting first.
  function setup(active: 'today' | 'chat', pendingCount = 0): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TodayChatSwitch],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(TodayChatSwitch);
    fixture.componentRef.setInput('active', active);
    fixture.componentRef.setInput('pendingCount', pendingCount);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('links Today to the root route and Chat to /chat', () => {
    const el = setup('today');
    const links = el.querySelectorAll('a');
    expect(links[0].getAttribute('href')).toBe('/');
    expect(links[1].getAttribute('href')).toBe('/chat');
  });

  it('marks the active half for assistive tech, not just visually', () => {
    expect(setup('chat').querySelectorAll('a')[1].getAttribute('aria-current')).toBe('page');
    expect(setup('chat').querySelectorAll('a')[0].hasAttribute('aria-current')).toBe(false);
  });

  it('shows the pending count on the chat half, and hides it at zero', () => {
    expect(setup('today', 2).querySelector('.badge')!.textContent!.trim()).toBe('2');
    expect(setup('today', 0).querySelector('.badge')).toBeNull();
  });
});
