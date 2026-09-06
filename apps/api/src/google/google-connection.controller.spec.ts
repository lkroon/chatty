import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { GoogleConnectionController } from './google-connection.controller';

function fakeRequest(session: Record<string, unknown> | undefined): Request {
  return { session } as unknown as Request;
}

describe('GoogleConnectionController', () => {
  const connections = { find: jest.fn(), upsert: jest.fn(), remove: jest.fn() };
  const tokens = { forget: jest.fn() };
  let controller: GoogleConnectionController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new GoogleConnectionController(connections as never, tokens as never);
  });

  it('status() rejects a request with no session account', async () => {
    await expect(controller.status(fakeRequest({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('status() reports not connected when there is no row', async () => {
    connections.find.mockResolvedValue(null);
    await expect(controller.status(fakeRequest({ accountId: '1' }))).resolves.toEqual({
      connected: false,
      scopes: [],
    });
  });

  it('status() reports the granted scopes when connected', async () => {
    connections.find.mockResolvedValue({ accountId: 1, refreshTokenSealed: 'x', scopes: ['a'] });
    await expect(controller.status(fakeRequest({ accountId: '1' }))).resolves.toEqual({
      connected: true,
      scopes: ['a'],
    });
  });

  it('disconnect() removes the row and forgets the cached token', async () => {
    await controller.disconnect(fakeRequest({ accountId: '1' }));
    expect(connections.remove).toHaveBeenCalledWith(1);
    expect(tokens.forget).toHaveBeenCalledWith(1);
  });
});
