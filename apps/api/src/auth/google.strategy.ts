import * as passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import type { VerifyCallback } from 'passport-oauth2';
import { Pool } from 'pg';
import { isEmailAllowed } from './allowlist';
import { upsertAccount } from './accounts.repository';

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  picture: string;
}

/**
 * The Passport verify callback. The allowlist check runs BEFORE any
 * account is upserted or session created: a non-match calls
 * `done(null, false)` (Passport's "authentication failed" signal, which
 * `passport.authenticate` turns into a failure — see AuthController's
 * callback route) rather than throwing, so a rejected login is always a
 * clean redirect, never a 500.
 */
export async function googleVerifyCallback(
  pool: Pool,
  profile: Profile,
  done: VerifyCallback,
): Promise<void> {
  try {
    const email = profile.emails?.[0]?.value;
    if (!email || !isEmailAllowed(email)) {
      done(null, false);
      return;
    }

    const account = await upsertAccount(pool, {
      googleSub: profile.id,
      email,
      displayName: profile.displayName ?? null,
    });

    const user: AuthenticatedUser = {
      id: account.id,
      email: account.email,
      name: profile.displayName ?? account.displayName ?? '',
      picture: profile.photos?.[0]?.value ?? '',
    };
    done(null, user);
  } catch (err) {
    done(err as Error);
  }
}

export function createGoogleStrategy(pool: Pool): GoogleStrategy {
  // Fail at boot rather than at the consent screen. Placeholder credentials
  // are accepted by this constructor and only rejected by Google, as an
  // "Error 401: invalid_client — The OAuth client was not found" page that
  // says nothing about the env var behind it. Matches
  // google/google-oauth.ts's requireCredentials(), and the boot-time
  // strictness SEARCH_PROVIDER already has.
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientID || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — login cannot work. ' +
        'Local dev loads them from the repo-root .env; see README.',
    );
  }
  return new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL: `${process.env.APP_ORIGIN ?? ''}/auth/google/callback`,
    },
    (_accessToken, _refreshToken, profile, done) => {
      void googleVerifyCallback(pool, profile, done);
    },
  );
}

export function registerGoogleStrategy(pool: Pool): void {
  passport.use(createGoogleStrategy(pool));
}
