import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { BriefingController } from './briefing.controller';

function fakeRequest(session: Record<string, unknown> | undefined): Request {
  return { session } as unknown as Request;
}

describe('BriefingController', () => {
  const service = { build: jest.fn() };
  let controller: BriefingController;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BRIEFING_MODEL;
    controller = new BriefingController(service as never);
  });

  it('rejects a request with no session account', async () => {
    await expect(controller.get(fakeRequest({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('passes the numeric account id through', async () => {
    service.build.mockResolvedValue({ date: '2026-09-05' });
    await controller.get(fakeRequest({ accountId: '42' }));
    expect(service.build).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('defaults to glm-5.3-flash', async () => {
    service.build.mockResolvedValue({});
    await controller.get(fakeRequest({ accountId: '1' }));
    expect(service.build).toHaveBeenCalledWith(1, 'glm-5.3-flash');
  });

  it('honours BRIEFING_MODEL when set', async () => {
    process.env.BRIEFING_MODEL = 'glm-5.3';
    service.build.mockResolvedValue({});
    await controller.get(fakeRequest({ accountId: '1' }));
    expect(service.build).toHaveBeenCalledWith(1, 'glm-5.3');
  });
});
