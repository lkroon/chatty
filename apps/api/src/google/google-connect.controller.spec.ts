import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleConnectController } from './google-connect.controller';
import * as oauth from './google-oauth';

function fakeRequest(session: Record<string, unknown> | undefined): Request {
  return { session } as unknown as Request;
}

function fakeResponse(): Response & { redirectedTo: string | null } {
  const res = {
    redirectedTo: null as string | null,
    redirect(url: string) {
      this.redirectedTo = url;
    },
  };
  return res as unknown as Response & { redirectedTo: string | null };
}

describe('GoogleConnectController', () => {
  const connections = {
    find: jest.fn(),
    upsert: jest.fn(),
    remove: jest.fn(),
  };
  const tokens = { forget: jest.fn() };
  let controller: GoogleConnectController;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.APP_ORIGIN = 'https://chat.example.com';
    controller = new GoogleConnectController(connections as never, tokens as never);
  });

  // clearAllMocks does NOT undo jest.spyOn — without this, the buildConsentUrl
  // stub below leaks into every later spec in the file.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('start() rejects a request with no session account', () => {
    expect(() => controller.start(fakeRequest({}), fakeResponse())).toThrow(UnauthorizedException);
  });

  it('start() stores a state value on the session and redirects to Google', () => {
    jest.spyOn(oauth, 'buildConsentUrl').mockReturnValue('https://accounts.google.test/x');
    const session: Record<string, unknown> = { accountId: '1' };
    const res = fakeResponse();
    controller.start(fakeRequest(session), res);
    expect(typeof session.googleConnectState).toBe('string');
    expect((session.googleConnectState as string).length).toBeGreaterThanOrEqual(32);
    expect(res.redirectedTo).toBe('https://accounts.google.test/x');
  });

  it('callback() refuses a mismatched state without exchanging the code', async () => {
    const exchange = jest.spyOn(oauth, 'exchangeCodeForTokens');
    const res = fakeResponse();
    await controller.callback(
      fakeRequest({ accountId: '1', googleConnectState: 'expected' }),
      res,
      'the-code',
      'attacker-supplied',
    );
    expect(exchange).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('https://chat.example.com/?connect=failed');
    expect(connections.upsert).not.toHaveBeenCalled();
  });

  it('callback() stores a sealed refresh token and clears the state', async () => {
    jest.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({
      refreshToken: 'rt',
      accessToken: 'at',
      expiresInSeconds: 3600,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const session: Record<string, unknown> = { accountId: '1', googleConnectState: 'st' };
    const res = fakeResponse();
    await controller.callback(fakeRequest(session), res, 'the-code', 'st');

    expect(connections.upsert).toHaveBeenCalledTimes(1);
    const [accountId, sealed, scopes] = connections.upsert.mock.calls[0];
    expect(accountId).toBe(1);
    expect(sealed).not.toContain('rt');
    expect(scopes).toEqual(['https://www.googleapis.com/auth/calendar.readonly']);
    expect(session.googleConnectState).toBeUndefined();
    expect(res.redirectedTo).toBe('https://chat.example.com/?connect=ok');
  });

  it('callback() redirects to failed when code is missing', async () => {
    const exchange = jest.spyOn(oauth, 'exchangeCodeForTokens');
    const res = fakeResponse();
    await controller.callback(
      fakeRequest({ accountId: '1', googleConnectState: 'st' }),
      res,
      undefined,
      'st',
    );
    expect(exchange).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('https://chat.example.com/?connect=failed');
    expect(connections.upsert).not.toHaveBeenCalled();
  });

  it('callback() redirects to failed when state is missing', async () => {
    const exchange = jest.spyOn(oauth, 'exchangeCodeForTokens');
    const res = fakeResponse();
    await controller.callback(
      fakeRequest({ accountId: '1', googleConnectState: 'st' }),
      res,
      'the-code',
      undefined,
    );
    expect(exchange).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('https://chat.example.com/?connect=failed');
    expect(connections.upsert).not.toHaveBeenCalled();
  });

  it('callback() redirects to failed and does not leak the error when exchange throws', async () => {
    jest.spyOn(oauth, 'exchangeCodeForTokens').mockRejectedValue(new Error('boom'));
    const session: Record<string, unknown> = { accountId: '1', googleConnectState: 'st' };
    const res = fakeResponse();
    await controller.callback(fakeRequest(session), res, 'the-code', 'st');

    expect(res.redirectedTo).toBe('https://chat.example.com/?connect=failed');
    expect(res.redirectedTo).not.toContain('boom');
    expect(connections.upsert).not.toHaveBeenCalled();
  });
});
