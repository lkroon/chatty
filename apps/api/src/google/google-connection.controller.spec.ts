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
    controller = new GoogleConnectionController(
      connections as never,
      tokens as never,
    );
  });

  it('status() rejects a request with no session account', async () => {
    await expect(controller.status(fakeRequest({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('status() reports not connected when there is no row', async () => {
    connections.find.mockResolvedValue(null);
    await expect(
      controller.status(fakeRequest({ accountId: '1' })),
    ).resolves.toEqual({
      connected: false,
      scopes: [],
      needsReconnect: false,
    });
  });

  it('status() reports the granted scopes when connected', async () => {
    connections.find.mockResolvedValue({
      accountId: 1,
      refreshTokenSealed: 'x',
      scopes: ['a'],
    });
    await expect(
      controller.status(fakeRequest({ accountId: '1' })),
    ).resolves.toEqual({
      connected: true,
      scopes: ['a'],
      needsReconnect: false,
    });
  });

  describe('needsReconnect', () => {
    // The flag is only meaningful while the write tools are on, so these two
    // set it explicitly rather than inheriting whatever the environment has.
    const previous = process.env.GOOGLE_WRITE_TOOLS_ENABLED;

    beforeEach(() => {
      process.env.GOOGLE_WRITE_TOOLS_ENABLED = 'true';
    });

    afterEach(() => {
      if (previous === undefined) {
        delete process.env.GOOGLE_WRITE_TOOLS_ENABLED;
      } else {
        process.env.GOOGLE_WRITE_TOOLS_ENABLED = previous;
      }
    });

    it('flags a connection made before gmail.modify existed', async () => {
      connections.find.mockResolvedValue({
        accountId: 1,
        refreshTokenSealed: 'x',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      });
      await expect(
        controller.status(fakeRequest({ accountId: '1' })),
      ).resolves.toEqual(expect.objectContaining({ needsReconnect: true }));
    });

    it('does not flag a current connection', async () => {
      connections.find.mockResolvedValue({
        accountId: 1,
        refreshTokenSealed: 'x',
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      });
      await expect(
        controller.status(fakeRequest({ accountId: '1' })),
      ).resolves.toEqual(expect.objectContaining({ needsReconnect: false }));
    });
  });

  it('disconnect() removes the row and forgets the cached token', async () => {
    await controller.disconnect(fakeRequest({ accountId: '1' }));
    expect(connections.remove).toHaveBeenCalledWith(1);
    expect(tokens.forget).toHaveBeenCalledWith(1);
  });
});
