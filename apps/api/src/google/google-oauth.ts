import type { ProposalKind } from '@contracts/proposal';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Exactly the two read-only scopes the briefing needs, and nothing else.
 *
 * Deliberately NOT requested at login (auth.controller.ts keeps
 * ['profile','email']): connecting a calendar is a second, opt-in consent,
 * so a user can log in without ever handing over their mailbox.
 *
 * calendar.readonly is a *sensitive* scope; gmail.readonly is *restricted*,
 * which is what puts this app in the "unverified, in production, <=100
 * users" bucket. Adding any write scope here changes that classification —
 * don't, without revisiting the plan.
 */
export const BRIEFING_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
];

/**
 * The write scopes, requested only when GOOGLE_WRITE_TOOLS_ENABLED=true.
 *
 * All three are *sensitive*, not restricted — note that `gmail.send` is a
 * lower tier than `gmail.compose`, because composing implies mailbox access.
 * plan 1's `gmail.readonly` already put this project in the restricted
 * bucket, so these add no new verification burden.
 *
 * Granting them changes what a confirmed proposal can do; it does NOT change
 * what the model can do on its own — see proposals.service.ts.
 */
export const WRITE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.send',
];

/** The write tools are off unless this is exactly "true". */
export function writeToolsEnabled(): boolean {
  return process.env.GOOGLE_WRITE_TOOLS_ENABLED === 'true';
}

/** Scopes to request on the consent screen, given the current configuration. */
export function grantedScopes(): string[] {
  return writeToolsEnabled() ? [...BRIEFING_SCOPES, ...WRITE_SCOPES] : [...BRIEFING_SCOPES];
}

/**
 * The scope a confirmed proposal of each kind needs.
 *
 * Checked against the scopes Google actually granted (stored per connection)
 * before anything is claimed, so an account connected before write tools
 * existed gets "reconnect Google" rather than an opaque 403.
 */
export const REQUIRED_SCOPE_BY_KIND: Readonly<Record<ProposalKind, string>> = {
  calendar_event: 'https://www.googleapis.com/auth/calendar.events',
  task: 'https://www.googleapis.com/auth/tasks',
  email: 'https://www.googleapis.com/auth/gmail.send',
};

/** Thrown message prefix the token service keys on to clear a dead connection. */
export const GRANT_REVOKED = 'GOOGLE_GRANT_REVOKED';

export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string;
  expiresInSeconds: number;
  scopes: string[];
}

function redirectUri(): string {
  return `${process.env.APP_ORIGIN ?? ''}/auth/google/connect/callback`;
}

function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
  }
  return { clientId, clientSecret };
}

export function buildConsentUrl(state: string): string {
  const { clientId } = requireCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: grantedScopes().join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const { clientId, clientSecret } = requireCredentials();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status})`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!body.refresh_token) {
    throw new Error(
      'Google returned no refresh_token — the grant was not made with access_type=offline and prompt=consent',
    );
  }

  return {
    refreshToken: body.refresh_token,
    accessToken: body.access_token ?? '',
    expiresInSeconds: body.expires_in ?? 0,
    scopes: (body.scope ?? '').split(' ').filter((s) => s.length > 0),
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const { clientId, clientSecret } = requireCredentials();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (response.status === 400 || response.status === 401) {
    throw new Error(`${GRANT_REVOKED}: Google refused the refresh token (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Google token refresh failed (${response.status})`);
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new Error('Google token refresh returned no access_token');
  }
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in ?? 0 };
}
