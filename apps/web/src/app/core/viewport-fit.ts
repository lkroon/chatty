import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Keeps the app sized to the *visual* viewport instead of the layout one.
 *
 * This app is used primarily as an iOS home-screen PWA on a small phone, and
 * there `100dvh` is not enough on its own:
 *
 *  - Opening the on-screen keyboard shrinks the visual viewport but leaves
 *    the layout viewport (and therefore `100dvh`, `100vh`, `innerHeight`)
 *    untouched. The composer ends up underneath the keyboard, and Safari
 *    "helpfully" scrolls the layout viewport to reveal it — which pushes the
 *    top bar, and with it the history button and the model picker, off screen.
 *  - Any residual scroll or pinch offset shows up as `offsetTop`/`offsetLeft`.
 *    A `position: fixed` element is pinned to the *layout* viewport, so it
 *    scrolls out of sight unless that offset is compensated for.
 *
 * So: publish the visual viewport's height and offsets as CSS custom
 * properties on <html>, and let the shell position itself against those. The
 * result is a shell that always occupies exactly the visible area, keyboard
 * open or closed, with its sticky top bar and composer both on screen.
 *
 * `--kb-safe-bottom` exists because `env(safe-area-inset-bottom)` keeps
 * reporting the home-indicator inset while the keyboard covers it; padding
 * for an indicator that isn't visible just wastes a scarce 34px.
 */
@Injectable({ providedIn: 'root' })
export class ViewportFit {
  /** Height of the visible area in CSS px. 0 until the first measurement. */
  readonly height = signal(0);
  /** True while an on-screen keyboard (or similar overlay) is covering the page. */
  readonly keyboardOpen = signal(false);

  private frame = 0;

  constructor() {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    if (!vv) {
      // No visualViewport (old browser, non-browser test env): the CSS
      // fallbacks of `100dvh` / `0px` apply and everything still works,
      // just without keyboard awareness.
      return;
    }

    const schedule = () => {
      if (this.frame) {
        return;
      }
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.measure(vv);
      });
    };

    this.measure(vv);
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('orientationchange', schedule);

    inject(DestroyRef).onDestroy(() => {
      if (this.frame) {
        cancelAnimationFrame(this.frame);
      }
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('orientationchange', schedule);
    });
  }

  private measure(vv: VisualViewport): void {
    const root = document.documentElement;
    // The keyboard is the only thing that takes a big bite out of the visual
    // viewport while the layout viewport stays put. 120px is comfortably more
    // than a collapsing URL bar and far less than any keyboard.
    const keyboardOpen = window.innerHeight - vv.height > 120;

    this.height.set(vv.height);
    this.keyboardOpen.set(keyboardOpen);

    root.style.setProperty('--app-height', `${vv.height}px`);
    root.style.setProperty('--app-offset-top', `${vv.offsetTop}px`);
    root.style.setProperty('--app-offset-left', `${vv.offsetLeft}px`);
    root.style.setProperty('--kb-safe-bottom', keyboardOpen ? '0px' : 'env(safe-area-inset-bottom)');
    root.classList.toggle('kb-open', keyboardOpen);

    // Undo the layout-viewport scroll Safari performs to reveal a focused
    // input. Once the keyboard is gone there is nothing left to reveal, and
    // leaving the page scrolled strands the shell half off screen.
    if (!keyboardOpen && window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  }
}
