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
  return new GoogleStrategy(
    {
      // No live Google OAuth credentials exist for this project yet; the
      // dev fallbacks below (mirroring main.ts's SESSION_SECRET pattern)
      // just keep the app bootable without them. A real deployment must
      // set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/APP_ORIGIN.
      clientID: process.env.GOOGLE_CLIENT_ID ?? 'dev-google-client-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? 'dev-google-client-secret',
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
