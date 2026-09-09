import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TOOL_DEFINITIONS } from '../tools/tool-definitions';
import { PROPOSAL_TOOL_DEFINITIONS } from '../tools/proposal-tool-definitions';
import { MailController } from './mail.controller';

function req(accountId?: string): Request {
  return { session: accountId ? { accountId } : {} } as unknown as Request;
}

describe('MailController', () => {
  let service: { markRead: jest.Mock; archive: jest.Mock };
  let controller: MailController;

  beforeEach(() => {
    service = {
      markRead: jest.fn().mockResolvedValue(undefined),
      archive: jest.fn().mockResolvedValue(undefined),
    };
    controller = new MailController(service as never);
  });

  it('marks a message read for the session account', async () => {
    await controller.read(req('7'), 'm1');
    expect(service.markRead).toHaveBeenCalledWith(7, 'm1');
  });

  it('archives a message for the session account', async () => {
    await controller.archive(req('7'), 'm1');
    expect(service.archive).toHaveBeenCalledWith(7, 'm1');
  });

  it('refuses a request with no session account', async () => {
    await expect(controller.read(req(), 'm1')).rejects.toThrow(UnauthorizedException);
  });

  it('surfaces a stale grant as Forbidden', async () => {
    service.archive.mockRejectedValue(new ForbiddenException('google_scope_missing'));
    await expect(controller.archive(req('7'), 'm1')).rejects.toThrow(ForbiddenException);
  });

  /**
   * These routes act on the user's mailbox with no confirmation card. They are
   * safe precisely because only a person's tap can reach them — if a mail tool
   * is ever added upstream, that stops being true and this fails.
   */
  it('is not exposed to the model as a tool', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.function.name)).toEqual(['web_search', 'web_fetch']);
    expect(PROPOSAL_TOOL_DEFINITIONS.map((t) => t.function.name)).toEqual([
      'create_calendar_event',
      'create_task',
      'send_email',
    ]);
  });
});
