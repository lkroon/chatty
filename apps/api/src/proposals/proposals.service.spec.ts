import { ConflictException, NotFoundException } from '@nestjs/common';
// NotConnectedError lives in google/errors.ts — google-token.service.ts
// imports it but does not re-export it. Same import briefing.service.ts uses.
import { NotConnectedError } from '../google/errors';
import * as executors from './proposal-executors';
import type { ProposalRow } from './proposal-row';
import { ProposalsService } from './proposals.service';

function row(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: 'p1',
    accountId: 1,
    conversationId: 'c1',
    kind: 'calendar_event',
    payload: {
      title: 'Dentist',
      start: '2026-09-08T15:00:00',
      end: '2026-09-08T15:45:00',
      location: null,
      description: null,
    },
    status: 'pending',
    externalId: null,
    externalLink: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeRepository {
  stored: ProposalRow | null = row();
  pending: ProposalRow[] = [];
  createInput: unknown = null;
  claimInput: { id: string; accountId: number; allowRetry: boolean } | null = null;
  claimResult: ProposalRow | null = row({ status: 'executing' });
  failedWith: string | null = null;

  async create(input: unknown): Promise<ProposalRow> {
    this.createInput = input;
    return row();
  }
  async findForAccount(id: string, accountId: number): Promise<ProposalRow | null> {
    return this.stored && this.stored.id === id && this.stored.accountId === accountId
      ? this.stored
      : null;
  }
  async claimForExecution(input: {
    id: string;
    accountId: number;
    allowRetry: boolean;
  }): Promise<ProposalRow | null> {
    this.claimInput = input;
    return this.claimResult;
  }
  async markExecuted(id: string, result: { externalId: string | null; link: string | null }) {
    return row({ status: 'executed', externalId: result.externalId, externalLink: result.link });
  }
  async markFailed(id: string, message: string) {
    this.failedWith = message;
    return row({ status: 'failed', error: message });
  }
  async discard(): Promise<ProposalRow | null> {
    return row({ status: 'discarded' });
  }
  async findPendingForAccount(): Promise<ProposalRow[]> {
    return this.pending;
  }
}

class FakeConnections {
  scopes: string[] = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/gmail.send',
  ];
  connected = true;
  async find(accountId: number) {
    return this.connected
      ? { accountId, refreshTokenSealed: 'sealed', scopes: this.scopes }
      : null;
  }
}

class FakeTokens {
  token: string | Error = 'at-1';
  async getAccessToken(): Promise<string> {
    if (this.token instanceof Error) {
      throw this.token;
    }
    return this.token;
  }
}

describe('ProposalsService', () => {
  let repository: FakeRepository;
  let connections: FakeConnections;
  let tokens: FakeTokens;
  let service: ProposalsService;
  let executeSpy: jest.SpyInstance;

  beforeEach(() => {
    repository = new FakeRepository();
    connections = new FakeConnections();
    tokens = new FakeTokens();
    service = new ProposalsService(
      repository as never,
      connections as never,
      tokens as never,
    );
    executeSpy = jest
      .spyOn(executors, 'executeProposal')
      .mockResolvedValue({ externalId: 'evt-1', link: 'https://cal/evt-1' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createFromToolCall', () => {
    it('persists a validated proposal and returns a pending card', async () => {
      const outcome = await service.createFromToolCall({
        accountId: 1,
        conversationId: 'c1',
        toolName: 'create_calendar_event',
        rawArguments: JSON.stringify({ title: 'Dentist', start: '2026-09-08T15:00:00' }),
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.ok === true && outcome.card.status).toBe('pending');
      expect(outcome.ok === true && outcome.card.confirmable).toBe(true);
      expect(repository.createInput).toEqual({
        accountId: 1,
        conversationId: 'c1',
        kind: 'calendar_event',
        payload: {
          title: 'Dentist',
          start: '2026-09-08T15:00:00',
          end: '2026-09-08T15:30:00',
          location: null,
          description: null,
        },
      });
    });

    it('hands the model back a correctable message instead of storing junk', async () => {
      const outcome = await service.createFromToolCall({
        accountId: 1,
        conversationId: 'c1',
        toolName: 'create_calendar_event',
        rawArguments: JSON.stringify({ title: 'X', start: 'tomorrow' }),
      });
      expect(outcome).toEqual({ ok: false, message: expect.stringContaining('"start"') });
      expect(repository.createInput).toBeNull();
    });

    it('refuses to queue more than ten proposals at once', async () => {
      // The cap on how much attention an injected model can consume: it can
      // still write rows, but not an unbounded number of them.
      repository.pending = Array.from({ length: 10 }, (_, i) => row({ id: `p${i}` }));
      const outcome = await service.createFromToolCall({
        accountId: 1,
        conversationId: 'c1',
        toolName: 'create_task',
        rawArguments: JSON.stringify({ title: 'One more' }),
      });
      expect(outcome).toEqual({ ok: false, message: expect.stringContaining('maximum') });
      expect(repository.createInput).toBeNull();
    });

    it('survives unparseable arguments', async () => {
      const outcome = await service.createFromToolCall({
        accountId: 1,
        conversationId: 'c1',
        toolName: 'create_task',
        rawArguments: '{not json',
      });
      expect(outcome).toEqual({ ok: false, message: expect.stringContaining('arguments') });
    });
  });

  describe('confirm', () => {
    it('executes the stored row and returns the executed card', async () => {
      const card = await service.confirm(1, 'p1');
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1', status: 'executing' }),
        'at-1',
        expect.any(String),
      );
      expect(card.status).toBe('executed');
      expect(card.link).toBe('https://cal/evt-1');
      expect(card.confirmable).toBe(false);
    });

    it('allows a retry only for a calendar event', async () => {
      await service.confirm(1, 'p1');
      expect(repository.claimInput!.allowRetry).toBe(true);

      repository.stored = row({
        kind: 'email',
        payload: { to: ['a@x.com'], subject: 'S', body: 'B' },
      });
      repository.claimResult = row({
        kind: 'email',
        status: 'executing',
        payload: { to: ['a@x.com'], subject: 'S', body: 'B' },
      });
      await service.confirm(1, 'p1');
      expect(repository.claimInput!.allowRetry).toBe(false);
    });

    it('404s a proposal that belongs to another account', async () => {
      await expect(service.confirm(2, 'p1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a proposal that is no longer confirmable', async () => {
      repository.stored = row({ status: 'executed' });
      await expect(service.confirm(1, 'p1')).rejects.toBeInstanceOf(ConflictException);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it('refuses when Google is not connected at all', async () => {
      connections.connected = false;
      await expect(service.confirm(1, 'p1')).rejects.toThrow(/not connected/i);
    });

    it('asks the user to reconnect when the grant predates write scopes', async () => {
      connections.scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
      await expect(service.confirm(1, 'p1')).rejects.toThrow(/reconnect/i);
      expect(repository.claimInput).toBeNull();
    });

    it('leaves the row unclaimed when the access token cannot be minted', async () => {
      tokens.token = new NotConnectedError();
      await expect(service.confirm(1, 'p1')).rejects.toBeInstanceOf(ConflictException);
      expect(repository.claimInput).toBeNull();
    });

    it('refuses when the claim finds nothing left to claim', async () => {
      repository.claimResult = null;
      await expect(service.confirm(1, 'p1')).rejects.toThrow(/already/i);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it('records a writer failure on the row and returns it as a failed card', async () => {
      executeSpy.mockRejectedValue(new Error('Calendar create failed (503)'));
      const card = await service.confirm(1, 'p1');
      expect(card.status).toBe('failed');
      expect(card.error).toBe('Calendar create failed (503)');
      expect(repository.failedWith).toBe('Calendar create failed (503)');
      // A failed calendar event may be retried — its id is the idempotency key.
      expect(card.confirmable).toBe(true);
    });
  });

  describe('pendingForAccount', () => {
    it('returns a card per live pending row', async () => {
      repository.pending = [row({ id: 'p1' }), row({ id: 'p2' })];
      const cards = await service.pendingForAccount(1);
      expect(cards.map((card) => card.id)).toEqual(['p1', 'p2']);
      expect(cards[0].expiresAt).not.toBeNull();
    });

    it('drops a row whose TTL has already run out', async () => {
      // Stored 'pending', but old enough that toProposalCard calls it
      // 'expired'. It must not appear on Today, where the only thing the
      // user could do with it is tap through to a card that refuses.
      repository.pending = [row({ id: 'stale', createdAt: new Date('2020-01-01T00:00:00Z') })];
      expect(await service.pendingForAccount(1)).toEqual([]);
    });
  });

  describe('discard', () => {
    it('discards a pending proposal', async () => {
      const card = await service.discard(1, 'p1');
      expect(card.status).toBe('discarded');
      expect(card.confirmable).toBe(false);
    });

    it('404s an unknown proposal', async () => {
      repository.stored = null;
      await expect(service.discard(1, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
