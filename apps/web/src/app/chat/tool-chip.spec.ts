import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { ToolCallChip } from '@contracts';

import { ToolChip } from './tool-chip';

describe('ToolChip', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ToolChip>>;

  function setChip(chip: ToolCallChip): void {
    fixture.componentRef.setInput('chip', chip);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ToolChip],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(ToolChip);
  });

  it('renders the label', () => {
    setChip({
      callId: 'c1',
      name: 'web_search',
      status: 'done',
      label: 'Searched "hacker news"',
      sources: [{ title: 'HN', url: 'https://news.ycombinator.com' }],
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Searched "hacker news"');
  });

  it('expands to sources on click when done with sources', () => {
    setChip({
      callId: 'c1',
      name: 'web_search',
      status: 'done',
      label: 'Searched "hacker news"',
      sources: [{ title: 'HN', url: 'https://news.ycombinator.com' }],
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.tool-chip__sources')).toBeNull();

    el.querySelector('.tool-chip')!.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    const sources = el.querySelector('.tool-chip__sources');
    expect(sources).not.toBeNull();
    const link = sources!.querySelector('a')!;
    expect(link.textContent).toBe('HN');
    expect(link.getAttribute('href')).toBe('https://news.ycombinator.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a running chip has no expander (clicking does nothing)', () => {
    setChip({
      callId: 'c1',
      name: 'web_search',
      status: 'running',
      label: 'Searching…',
      sources: [],
    });
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector('.tool-chip')!.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(el.querySelector('.tool-chip__sources')).toBeNull();
    expect(el.querySelector('.spinner')).not.toBeNull();
  });

  it('a failed chip with no sources is not expandable', () => {
    setChip({
      callId: 'c1',
      name: 'web_fetch',
      status: 'failed',
      label: "Couldn't read example.com",
      sources: [],
    });
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector('.tool-chip')!.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(el.querySelector('.tool-chip__sources')).toBeNull();
    expect(el.querySelector('.tool-chip')!.classList).not.toContain('tool-chip--expandable');
  });
});
