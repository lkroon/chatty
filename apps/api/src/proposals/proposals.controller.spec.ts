import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { ProposalCard } from '@contracts/proposal';
import { ProposalsController } from './proposals.controller';

const card: ProposalCard = {
  id: 'p1',
  kind: 'calendar_event',
  status: 'executed',
  title: 'Dentist',
  fields: [],
  link: null,
  error: null,
  confirmable: false,
  // Null because the proposal is settled — a settled proposal has no deadline
  // left to run. See the ProposalCard contract in Task 1.
  expiresAt: null,
  conversationId: 'c1',
};

class FakeService {
  confirmCalls: { accountId: number; id: string }[] = [];
  discardCalls: { accountId: number; id: string }[] = [];
  async confirm(accountId: number, id: string) {
    this.confirmCalls.push({ accountId, id });
    return card;
  }
  async discard(accountId: number, id: string) {
    this.discardCalls.push({ accountId, id });
    return { ...card, status: 'discarded' as const };
  }
}

function request(accountId?: string): Request {
  return { session: accountId ? { accountId } : {} } as unknown as Request;
}

describe('ProposalsController', () => {
  let service: FakeService;
  let controller: ProposalsController;

  beforeEach(() => {
    service = new FakeService();
    controller = new ProposalsController(service as never);
  });

  it('confirms with the session account and the path id only', async () => {
    await expect(controller.confirm(request('7'), 'p1')).resolves.toEqual(card);
    expect(service.confirmCalls).toEqual([{ accountId: 7, id: 'p1' }]);
  });

  it('discards with the session account and the path id only', async () => {
    const result = await controller.discard(request('7'), 'p1');
    expect(result.status).toBe('discarded');
    expect(service.discardCalls).toEqual([{ accountId: 7, id: 'p1' }]);
  });

  it('rejects an unauthenticated confirm', async () => {
    await expect(controller.confirm(request(), 'p1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.confirmCalls).toEqual([]);
  });

  it('rejects a session whose accountId is not a number', async () => {
    await expect(controller.confirm(request('not-a-number'), 'p1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
