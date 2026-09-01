import { Component } from '@angular/core';

// The login screen. There is no local auth in this app — the only way in is
// Google OAuth, so this is intentionally a plain <a>, not a routerLink: it
// must trigger a full-page navigation to /auth/google (handled by the API
// server), not a client-side route change.
@Component({
  selector: 'app-login-shell',
  imports: [],
  template: `
    <main class="login">
      <div class="login__card">
        <h1 class="login__title">opencode-chat</h1>
        <p class="login__subtitle">Sign in to continue</p>
        <a class="login__button" href="/auth/google"> Sign in with Google </a>
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
    }

    .login__card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      max-width: 22rem;
      text-align: center;
    }

    .login__title {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 600;
    }

    .login__subtitle {
      margin: 0 0 0.5rem;
      color: var(--color-text-muted);
    }

    .login__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 0.75rem 1.25rem;
      border-radius: 0.5rem;
      background: var(--color-primary);
      color: #fff;
      font-weight: 500;
      text-decoration: none;
    }

    .login__button:active {
      opacity: 0.85;
    }
  `,
})
export class LoginShell {}
