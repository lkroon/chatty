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
      min-height: 100dvh;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      background: var(--color-bg, #eef6f2);
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
      font-family: 'Baloo 2', sans-serif;
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--oc-accent-ink, #7a2c22);
    }

    .login__subtitle {
      margin: 0 0 0.75rem;
      color: var(--color-text-muted, #6f7a76);
    }

    .login__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 0.85rem 1.25rem;
      border-radius: 999px;
      background: var(--color-primary, #ff6f59);
      color: #fff;
      font-weight: 700;
      text-decoration: none;
    }

    .login__button:active {
      opacity: 0.85;
    }
  `,
})
export class LoginShell {}
