import {
  BRIEFING_SCOPES,
  buildConsentUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from './google-oauth';

describe('google-oauth', () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.APP_ORIGIN = 'https://chat.example.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...env };
  });

  describe('buildConsentUrl', () => {
    it('requests offline access and forces the consent screen', () => {
      const url = new URL(buildConsentUrl('state-123'));
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('state')).toBe('state-123');
      expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    });

    it('asks for exactly the two read-only scopes and no others', () => {
      const url = new URL(buildConsentUrl('s'));
      expect(url.searchParams.get('scope')).toBe(BRIEFING_SCOPES.join(' '));
      expect(url.searchParams.get('scope')).not.toContain('gmail.send');
      expect(url.searchParams.get('scope')).not.toContain('calendar.events');
    });

    it('points the redirect at APP_ORIGIN', () => {
      const url = new URL(buildConsentUrl('s'));
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://chat.example.com/auth/google/connect/callback',
      );
    });

    it('throws when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect(() => buildConsentUrl('s')).toThrow(/GOOGLE_CLIENT_ID/);
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('returns the refresh token and granted scopes', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3599,
            scope: 'https://www.googleapis.com/auth/calendar.readonly',
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

      await expect(exchangeCodeForTokens('the-code')).resolves.toEqual({
        refreshToken: 'rt',
        accessToken: 'at',
        expiresInSeconds: 3599,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
    });

    it('throws when Google omits the refresh token', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'at', expires_in: 3599, scope: '' }), {
          status: 200,
        }),
      ) as unknown as typeof fetch;

      await expect(exchangeCodeForTokens('c')).rejects.toThrow(/no refresh_token/);
    });

    it('throws, without echoing the body, on a non-200', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('{"error":"invalid_grant"}', { status: 400 }),
      ) as unknown as typeof fetch;

      await expect(exchangeCodeForTokens('c')).rejects.toThrow(/token exchange failed \(400\)/);
    });
  });

  describe('refreshAccessToken', () => {
    it('returns a fresh access token and its lifetime', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3599 }), { status: 200 }),
      ) as unknown as typeof fetch;

      await expect(refreshAccessToken('rt')).resolves.toEqual({
        accessToken: 'fresh',
        expiresInSeconds: 3599,
      });
    });

    it('reports a revoked grant distinguishably', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('{"error":"invalid_grant"}', { status: 400 }),
      ) as unknown as typeof fetch;

      await expect(refreshAccessToken('rt')).rejects.toThrow(/GOOGLE_GRANT_REVOKED/);
    });

    it('throws when a successful refresh response has no access_token', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }),
      ) as unknown as typeof fetch;

      await expect(refreshAccessToken('rt')).rejects.toThrow(/no access_token/);
    });

    it('throws a generic error for a non-400/401 refresh failure', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('{}', { status: 500 }),
      ) as unknown as typeof fetch;

      await expect(refreshAccessToken('rt')).rejects.toThrow(/Google token refresh failed \(500\)/);
    });
  });
});
