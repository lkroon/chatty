import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { PendingRail } from './pending-rail';

describe('PendingRail', () => {
  function setup(count: number): HTMLElement {
    // Reset before each call: this helper is invoked more than once inside a
    // single test (see the two tests below that compare two counts), and
    // TestBed refuses a second configureTestingModule once a component from
    // the first has been created.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PendingRail],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(PendingRail);
    fixture.componentRef.setInput('count', count);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('says nothing at all when nothing is waiting', () => {
    expect(setup(0).textContent!.trim()).toBe('');
  });

  it('counts what is waiting and links to Today', () => {
    const el = setup(3);
    expect(el.textContent).toContain('3');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/');
  });

  it('reads as one item, not three, when there is one', () => {
    expect(setup(1).textContent).toContain('1 write waiting');
    expect(setup(2).textContent).toContain('2 writes waiting');
  });

  it('scopes itself to this conversation, so it cannot be read as the global count', () => {
    // Today's badge counts every conversation; this one counts the cards on
    // screen. Saying which is which is what stops the two numbers looking
    // like a bug when they disagree.
    expect(setup(1).textContent).toContain('in this chat');
  });
});
