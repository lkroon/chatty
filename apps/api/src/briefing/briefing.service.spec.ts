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

describe('BriefingService', () => {
  let tokens: { getAccessToken: jest.Mock };
  let opencode: { streamChatCompletion: jest.Mock };
  let calendar: jest.Mock;
  let gmail: jest.Mock;
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
    gmail = jest.fn().mockResolvedValue([
      { id: 'm1', from: 'a@b.c', subject: 'Hi', snippet: 's', receivedAt: '2026-09-05T07:00:00.000Z' },
    ]);
    service = new BriefingService(tokens as never, opencode as never, calendar, gmail);
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
    gmail.mockResolvedValue([]);
    const briefing = await service.build(1, 'glm-5.3-flash');
    expect(opencode.streamChatCompletion).not.toHaveBeenCalled();
    expect(briefing.summary).toBe('');
  });
});
