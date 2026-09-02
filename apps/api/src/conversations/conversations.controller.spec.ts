import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// Fast unit test (no DB) — verifies the controller reads
// req.session.accountId and scopes every call to it, and 401s when it's
// missing. Real persistence/scoping behavior is covered by
// conversations.service.integration.spec.ts.
//
// NOTE: uses a try/catch helper instead of `.rejects` — see the comment
// in conversations.service.integration.spec.ts for why (@types/jasmine
// hoisted from apps/web shadows @types/jest's `.rejects` typing here).
async function expectRejectsWith(
  promise: Promise<unknown>,
  ctor: new (...args: never[]) => Error,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ctor);
    return;
  }
  throw new Error('expected promise to reject, but it resolved');
}

describe('ConversationsController', () => {
  function makeService() {
    return {
      listForAccount: jest.fn().mockResolvedValue([]),
      getDetailForAccount: jest.fn().mockResolvedValue({
        id: 'c1',
        title: 't',
        messages: [],
      }),
      deleteForAccount: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ConversationsService>;
  }

  function reqWithAccount(accountId?: string): Request {
    return { session: { accountId } } as unknown as Request;
  }

  it('list() throws Unauthorized when there is no session accountId', async () => {
    const controller = new ConversationsController(makeService());
    await expectRejectsWith(
      controller.list(reqWithAccount(undefined)),
      UnauthorizedException,
    );
  });

  it('list() scopes to the session accountId', async () => {
    const service = makeService();
    const controller = new ConversationsController(service);
    await controller.list(reqWithAccount('42'));
    expect(service.listForAccount).toHaveBeenCalledWith('42');
  });

  it('detail() scopes to the session accountId', async () => {
    const service = makeService();
    const controller = new ConversationsController(service);
    await controller.detail(reqWithAccount('42'), 'conv-1');
    expect(service.getDetailForAccount).toHaveBeenCalledWith('42', 'conv-1');
  });

  it('detail() throws Unauthorized when there is no session accountId', async () => {
    const controller = new ConversationsController(makeService());
    await expectRejectsWith(
      controller.detail(reqWithAccount(undefined), 'conv-1'),
      UnauthorizedException,
    );
  });

  it('remove() scopes to the session accountId', async () => {
    const service = makeService();
    const controller = new ConversationsController(service);
    await controller.remove(reqWithAccount('42'), 'conv-1');
    expect(service.deleteForAccount).toHaveBeenCalledWith('42', 'conv-1');
  });

  it('remove() throws Unauthorized when there is no session accountId', async () => {
    const controller = new ConversationsController(makeService());
    await expectRejectsWith(
      controller.remove(reqWithAccount(undefined), 'conv-1'),
      UnauthorizedException,
    );
  });
});
