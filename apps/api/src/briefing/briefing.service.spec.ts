import type { ProposalCard } from '@contracts/proposal';
import { BriefingService } from './briefing.service';
import { NotConnectedError } from '../google/errors';
import type { OpencodeStreamChunk } from '../opencode/opencode-client.types';

function stream(chunks: OpencodeStreamChunk[]): AsyncGenerator<OpencodeStreamChunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

function pendingCard(id: string): ProposalCard {
  return {
    id,
    kind: 'calendar_event',
    status: 'pending',
    title: 'Dentist',
    fields: [{ label: 'When', value: 'Tue 8 Sep 2026, 15:00 – 15:45' }],
    link: null,
    error: null,
    confirmable: true,
    expiresAt: '2026-09-08T09:59:00.000Z',
    conversationId: 'c1',
  };
}

class FakeProposals {
  cards: ProposalCard[] = [];
  calledWith: number | null = null;
  async pendingForAccount(accountId: number): Promise<ProposalCard[]> {
    this.calledWith = accountId;
    return this.cards;
  }
}

describe('BriefingService', () => {
  let tokens: { getAccessToken: jest.Mock };
  let opencode: { streamChatCompletion: jest.Mock };
  let calendar: jest.Mock;
  let gmail: jest.Mock;
  let tasksFetcher: jest.Mock;
  let proposals: FakeProposals;
  let service: BriefingService;

  beforeEach(() => {
    process.env.BRIEFING_TIMEZONE = 'Europe/Amsterdam';
    tokens = { getAccessToken: jest.fn().mockResolvedValue('at') };
    opencode = {
      streamChatCompletion: jest.fn(() =>
        stream([
          { type: 'delta', text: 'Busy ' },
          { type: 'delta', text: 'morning.' },
          { type: 'done', finishReason: 'stop', toolCalls: [], cost: null },
        ] as OpencodeStreamChunk[]),
      ),
    };
    calendar = jest.fn().mockResolvedValue([
      { id: 'e1', title: 'Standup', start: '2026-09-05T09:00:00+02:00', end: null, allDay: false, location: null },
    ]);
    gmail = jest.fn().mockResolvedValue({
      items: [
        { id: 'm1', from: 'a@b.c', subject: 'Hi', snippet: 's', receivedAt: '2026-09-05T07:00:00.000Z' },
      ],
      hasMore: false,
    });
    tasksFetcher = jest.fn().mockResolvedValue([
      { id: 't1', title: 'Renew passport', due: '2026-09-05', overdue: false, notes: null },
    ]);
    proposals = new FakeProposals();
    service = new BriefingService(
      tokens as never,
      opencode as never,
      calendar,
      gmail,
      tasksFetcher,
      proposals as never,
    );
  });

  it('returns both sections and the summary', async () => {
    const briefing = await service.build(1, 'glm-5.3-flash');
    expect(briefing.calendar).toEqual({ status: 'ok', items: [expect.objectContaining({ id: 'e1' })] });
    expect(briefing.mail).toEqual({ status: 'ok', items: [expect.objectContaining({ id: 'm1' })] });
    expect(briefing.summary).toBe('Busy morning.');
    expect(briefing.timeZone).toBe('Europe/Amsterdam');
  });

  it('never offers tools on the summarization call', async () => {
    await service.build(1, 'glm-5.3-flash');
    const params = opencode.streamChatCompletion.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
  });

  it('frames the fetched data as untrusted in the prompt', async () => {
    await service.build(1, 'glm-5.3-flash');
    const params = opencode.streamChatCompletion.mock.calls[0][0];
    const userMessage = params.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('<untrusted-user-data>');
  });

  it('marks both sections not_connected when there is no Google grant', async () => {
    tokens.getAccessToken.mockRejectedValue(new NotConnectedError());
    const briefing = await service.build(1, 'glm-5.3-flash');
    expect(briefing.calendar).toEqual({ status: 'not_connected' });
    expect(briefing.mail).toEqual({ status: 'not_connected' });
    expect(opencode.streamChatCompletion).not.toHaveBeenCalled();
    expect(briefing.summary).toBe('');
  });

  it('keeps the calendar section when only mail fails', async () => {
    gmail.mockRejectedValue(new Error('Gmail request failed (500)'));
    const briefing = await service.build(1, 'glm-5.3-flash');
    expect(briefing.calendar.status).toBe('ok');
    expect(briefing.mail).toEqual({ status: 'error', message: 'Could not read your mail.' });
  });

  it('still returns the sections when summarization fails', async () => {
    opencode.streamChatCompletion.mockImplementation(() => {
      throw new Error('upstream down');
    });
    const briefing = await service.build(1, 'glm-5.3-flash');
    expect(briefing.summary).toBe('');
    expect(briefing.calendar.status).toBe('ok');
  });

  it('skips summarization when both sections are empty', async () => {
    calendar.mockResolvedValue([]);
    gmail.mockResolvedValue({ items: [], hasMore: false });
    tasksFetcher.mockResolvedValue([]);
    const briefing = await service.build(1, 'glm-5.3-flash');
    expect(opencode.streamChatCompletion).not.toHaveBeenCalled();
    expect(briefing.summary).toBe('');
  });

  it('carries the account\'s pending proposals', async () => {
    proposals.cards = [pendingCard('p1')];
    const briefing = await service.build(7, 'model-x');
    expect(proposals.calledWith).toBe(7);
    expect(briefing.pending.map((card) => card.id)).toEqual(['p1']);
  });

  it('returns an empty list rather than failing when proposals cannot be read', async () => {
    // A broken proposals query must not cost the user their agenda. Same
    // rule the calendar and mail sections already follow.
    proposals.pendingForAccount = () => Promise.reject(new Error('boom'));
    const briefing = await service.build(7, 'model-x');
    expect(briefing.pending).toEqual([]);
    expect(briefing.calendar.status).toBe('ok');
  });

  it('sends no pending proposals to the summarizer', async () => {
    // The summary describes the day, not the queue. Proposals are the
    // model's own output coming back around; feeding them in invites it to
    // narrate "I have already scheduled..." over a card nobody confirmed.
    proposals.cards = [pendingCard('p1')];
    await service.build(7, 'model-x');
    expect(JSON.stringify(opencode.streamChatCompletion.mock.calls[0][0])).not.toContain('p1');
  });

  it('buildItems returns every section without calling the model', async () => {
    const items = await service.buildItems(1);
    expect(items.calendar.status).toBe('ok');
    expect(items.tasks).toEqual({ status: 'ok', items: [expect.objectContaining({ id: 't1' })] });
    expect(items.mail.status).toBe('ok');
    expect(items.mailHasMore).toBe(false);
    expect(opencode.streamChatCompletion).not.toHaveBeenCalled();
    expect(items).not.toHaveProperty('summary');
  });

  it('buildItems reports mail overflow', async () => {
    gmail.mockResolvedValue({ items: [], hasMore: true });
    const items = await service.buildItems(1);
    expect(items.mailHasMore).toBe(true);
  });

  it('buildItems marks all three sections not_connected without a Google grant', async () => {
    tokens.getAccessToken.mockRejectedValue(new NotConnectedError());
    const items = await service.buildItems(1);
    expect(items.calendar).toEqual({ status: 'not_connected' });
    expect(items.tasks).toEqual({ status: 'not_connected' });
    expect(items.mail).toEqual({ status: 'not_connected' });
  });

  it('keeps the other sections when only tasks fail', async () => {
    tasksFetcher.mockRejectedValue(new Error('Tasks request failed (500)'));
    const items = await service.buildItems(1);
    expect(items.calendar.status).toBe('ok');
    expect(items.tasks).toEqual({ status: 'error', message: 'Could not read your tasks.' });
  });

  it('puts tasks in the summarization payload', async () => {
    await service.build(1, 'glm-5.3-flash');
    const params = opencode.streamChatCompletion.mock.calls[0][0];
    const userMessage = params.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('Renew passport');
  });

  it('scopes the upstream session to the day', async () => {
    await service.build(7, 'glm-5.3-flash');
    const params = opencode.streamChatCompletion.mock.calls[0][0];
    expect(params.sessionId).toMatch(/^briefing-7-\d{4}-\d{2}-\d{2}$/);
  });
});
