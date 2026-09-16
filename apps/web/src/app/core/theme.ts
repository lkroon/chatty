import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

/** What the user asked for. 'system' is the default and follows the OS. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** What is actually on screen once 'system' has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'chatty.theme';

/** The <html> background of each theme, for the browser/OS chrome around the PWA. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#eef1f6',
  dark: '#0e1218',
};

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Private mode, or site data blocked. Following the OS is the right
    // fallback — it is also what a first-time visitor gets.
    return 'system';
  }
}

/**
 * Day/night for the whole app: Daylight and Slate & Ice, the two palettes
 * defined in styles.scss.
 *
 * The choice is stamped on <html> as data-theme, which is what the token
 * blocks key off. 'system' stamps nothing at all, so the
 * prefers-color-scheme media query is left to decide — that is the only
 * state in which the app follows the OS live, without a reload.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);

  /** Tracks the OS setting so `resolved` recomputes when it flips at sunset. */
  private readonly systemPrefersDark = signal(this.queryPrefersDark());

  readonly choice = signal<ThemeChoice>(readStored());

  readonly resolved = computed<ResolvedTheme>(() => {
    const choice = this.choice();
    if (choice !== 'system') {
      return choice;
    }
    return this.systemPrefersDark() ? 'dark' : 'light';
  });

  constructor() {
    const media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', (event) => this.systemPrefersDark.set(event.matches));

    effect(() => {
      const root = this.document.documentElement;
      const choice = this.choice();
      if (choice === 'system') {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', choice);
      }
      this.paintBrowserChrome(this.resolved());
    });
  }

  /** Flips to the opposite of what is currently on screen, and stops following the OS. */
  toggle(): void {
    this.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    try {
      if (choice === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, choice);
      }
    } catch {
      // The choice still applies for this session; it just will not survive
      // a reload. Not worth telling the user about.
    }
  }

  private queryPrefersDark(): boolean {
    return this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  /**
   * Replaces index.html's two media-scoped theme-color tags with a single
   * resolved one. They are the right default before the app boots, but they
   * answer to the OS, and an explicit choice has to beat the OS here too —
   * otherwise the notch area stays dark behind a light app.
   */
  private paintBrowserChrome(theme: ResolvedTheme): void {
    const head = this.document.head;
    head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
    const meta = this.document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', THEME_COLOR[theme]);
    head.appendChild(meta);
  }
}
