import { Component } from '@angular/core';

import { ChattyLogo } from '../shared/chatty-logo';

// The login screen. There is no local auth in this app — the only way in is
// Google OAuth, so this is intentionally a plain <a>, not a routerLink: it
// must trigger a full-page navigation to /auth/google (handled by the API
// server), not a client-side route change.
@Component({
  selector: 'app-login-shell',
  imports: [ChattyLogo],
  template: `
    <main class="login">
      <div class="login__card">
        <app-chatty-logo [size]="56" />
        <h1 class="login__title">Chatty</h1>
        <p class="login__subtitle">Sign in to continue</p>
        <a class="login__button" href="/auth/google"> Continue with Google </a>
      </div>
    </main>
  `,
  styles: `
    .login {
      display: flex;
      /* <body> is locked against scrolling (see styles.scss), so the login
         card sizes itself to the visible area like every other screen. */
      height: var(--app-height, 100dvh);
      overflow-y: auto;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      background: var(--oc-bg);
    }

    .login__card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      max-width: 22rem;
      text-align: center;
    }

    .login__title {
      margin: 0.4rem 0 0;
      font-size: 1.8rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--oc-text);
    }

    .login__subtitle {
      margin: 0 0 0.75rem;
      color: var(--oc-text-muted);
    }

    .login__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 0.85rem 1.25rem;
      border-radius: var(--oc-r);
      background: var(--oc-accent);
      color: var(--oc-on-accent);
      font-weight: 600;
      text-decoration: none;
    }

    .login__button:active {
      opacity: 0.85;
    }
  `,
})
export class LoginShell {}
