import * as calendarWriter from './calendar-writer';
import * as gmailWriter from './gmail-writer';
import { executeProposal } from './proposal-executors';
import type { ProposalRow } from './proposal-row';
import * as tasksWriter from './tasks-writer';

function row(overrides: Partial<ProposalRow>): ProposalRow {
  return {
    id: 'p1',
    accountId: 1,
    conversationId: null,
    kind: 'calendar_event',
    payload: {
      title: 'Dentist',
      start: '2026-09-08T15:00:00',
      end: '2026-09-08T15:45:00',
      location: null,
      description: null,
    },
    status: 'executing',
    externalId: null,
    externalLink: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('executeProposal', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes a calendar event to the calendar writer, with the row id and zone', async () => {
    const spy = jest
      .spyOn(calendarWriter, 'createCalendarEvent')
      .mockResolvedValue({ externalId: 'evt-1', link: null });

    await expect(executeProposal(row({}), 'at-1', 'Europe/Amsterdam')).resolves.toEqual({
      externalId: 'evt-1',
      link: null,
    });
    expect(spy).toHaveBeenCalledWith(
      'at-1',
      expect.objectContaining({ title: 'Dentist' }),
      'p1',
      'Europe/Amsterdam',
    );
  });

  it('routes a task to the tasks writer', async () => {
    const spy = jest
      .spyOn(tasksWriter, 'createTask')
      .mockResolvedValue({ externalId: 'task-1', link: null });

    await executeProposal(
      row({ kind: 'task', payload: { title: 'Buy milk', due: null, notes: null } }),
      'at-1',
      'Europe/Amsterdam',
    );
    expect(spy).toHaveBeenCalledWith('at-1', { title: 'Buy milk', due: null, notes: null });
  });

  it('routes an email to the gmail writer', async () => {
    const spy = jest
      .spyOn(gmailWriter, 'sendEmail')
      .mockResolvedValue({ externalId: 'msg-1', link: null });

    await executeProposal(
      row({ kind: 'email', payload: { to: ['a@x.com'], subject: 'S', body: 'B' } }),
      'at-1',
      'Europe/Amsterdam',
    );
    expect(spy).toHaveBeenCalledWith('at-1', { to: ['a@x.com'], subject: 'S', body: 'B' });
  });

  it('refuses a kind it does not know', async () => {
    await expect(
      executeProposal(row({ kind: 'wire_transfer' as never }), 'at-1', 'Europe/Amsterdam'),
    ).rejects.toThrow('wire_transfer');
  });
});
