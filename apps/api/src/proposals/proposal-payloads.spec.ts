import {
  addMinutes,
  normalizeLocalDateTime,
  validateProposalArguments,
} from './proposal-payloads';

describe('normalizeLocalDateTime', () => {
  it('pads missing seconds', () => {
    expect(normalizeLocalDateTime('2026-09-08T15:00')).toBe('2026-09-08T15:00:00');
  });

  it('accepts a full local time unchanged', () => {
    expect(normalizeLocalDateTime('2026-09-08T15:30:45')).toBe('2026-09-08T15:30:45');
  });

  it('rejects a timezone offset — times are local wall clock only', () => {
    expect(normalizeLocalDateTime('2026-09-08T15:00:00+02:00')).toBeNull();
    expect(normalizeLocalDateTime('2026-09-08T13:00:00Z')).toBeNull();
  });

  it('rejects a date that does not exist', () => {
    expect(normalizeLocalDateTime('2026-02-31T10:00:00')).toBeNull();
  });

  it('rejects junk', () => {
    expect(normalizeLocalDateTime('next tuesday')).toBeNull();
  });
});

describe('addMinutes', () => {
  it('adds within the same day', () => {
    expect(addMinutes('2026-09-08T15:00:00', 30)).toBe('2026-09-08T15:30:00');
  });

  it('rolls over midnight', () => {
    expect(addMinutes('2026-09-08T23:50:00', 30)).toBe('2026-09-09T00:20:00');
  });
});

describe('validateProposalArguments', () => {
  describe('create_calendar_event', () => {
    it('accepts a full event', () => {
      expect(
        validateProposalArguments('create_calendar_event', {
          title: 'Dentist',
          start: '2026-09-08T15:00:00',
          end: '2026-09-08T15:45:00',
          location: 'Kerkstraat 1',
          description: 'Six-month check-up',
        }),
      ).toEqual({
        ok: true,
        kind: 'calendar_event',
        payload: {
          title: 'Dentist',
          start: '2026-09-08T15:00:00',
          end: '2026-09-08T15:45:00',
          location: 'Kerkstraat 1',
          description: 'Six-month check-up',
        },
      });
    });

    it('defaults a missing end to 30 minutes after the start', () => {
      const result = validateProposalArguments('create_calendar_event', {
        title: 'Standup',
        start: '2026-09-08T09:00',
      });
      expect(result).toEqual({
        ok: true,
        kind: 'calendar_event',
        payload: {
          title: 'Standup',
          start: '2026-09-08T09:00:00',
          end: '2026-09-08T09:30:00',
          location: null,
          description: null,
        },
      });
    });

    it('rejects an end at or before the start', () => {
      const result = validateProposalArguments('create_calendar_event', {
        title: 'Standup',
        start: '2026-09-08T09:00:00',
        end: '2026-09-08T09:00:00',
      });
      expect(result).toEqual({ ok: false, message: expect.stringContaining('after') });
    });

    it('rejects a missing title', () => {
      const result = validateProposalArguments('create_calendar_event', {
        start: '2026-09-08T09:00:00',
      });
      expect(result).toEqual({ ok: false, message: expect.stringContaining('title') });
    });

    it('explains the required time format when the start is unparseable', () => {
      const result = validateProposalArguments('create_calendar_event', {
        title: 'X',
        start: 'tomorrow at 3',
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toContain('2026-');
    });
  });

  describe('create_task', () => {
    it('accepts a task with a due date', () => {
      expect(
        validateProposalArguments('create_task', {
          title: 'Renew passport',
          due: '2026-09-30',
          notes: 'Town hall',
        }),
      ).toEqual({
        ok: true,
        kind: 'task',
        payload: { title: 'Renew passport', due: '2026-09-30', notes: 'Town hall' },
      });
    });

    it('accepts a task with no due date', () => {
      expect(validateProposalArguments('create_task', { title: 'Buy milk' })).toEqual({
        ok: true,
        kind: 'task',
        payload: { title: 'Buy milk', due: null, notes: null },
      });
    });

    it('rejects a due date that is not a plain date', () => {
      const result = validateProposalArguments('create_task', {
        title: 'X',
        due: '2026-09-30T10:00:00',
      });
      expect(result).toEqual({ ok: false, message: expect.stringContaining('YYYY-MM-DD') });
    });
  });

  describe('send_email', () => {
    it('accepts a single recipient given as a string', () => {
      expect(
        validateProposalArguments('send_email', {
          to: 'someone@example.com',
          subject: 'Hello',
          body: 'Hi there',
        }),
      ).toEqual({
        ok: true,
        kind: 'email',
        payload: { to: ['someone@example.com'], subject: 'Hello', body: 'Hi there' },
      });
    });

    it('accepts an array of recipients', () => {
      const result = validateProposalArguments('send_email', {
        to: ['a@example.com', 'b@example.com'],
        subject: 'Hello',
        body: 'Hi',
      });
      expect(result.ok === true && (result.payload as { to: string[] }).to).toEqual([
        'a@example.com',
        'b@example.com',
      ]);
    });

    it('rejects an address that is not an address', () => {
      const result = validateProposalArguments('send_email', {
        to: 'not-an-address',
        subject: 'Hello',
        body: 'Hi',
      });
      expect(result).toEqual({ ok: false, message: expect.stringContaining('email address') });
    });

    it('rejects more than five recipients', () => {
      const result = validateProposalArguments('send_email', {
        to: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'],
        subject: 'Hello',
        body: 'Hi',
      });
      expect(result).toEqual({ ok: false, message: expect.stringContaining('5') });
    });

    it('rejects an empty body', () => {
      const result = validateProposalArguments('send_email', {
        to: 'a@x.com',
        subject: 'Hello',
        body: '   ',
      });
      expect(result).toEqual({ ok: false, message: expect.stringContaining('body') });
    });
  });

  it('rejects an unknown tool name', () => {
    expect(validateProposalArguments('delete_everything', {})).toEqual({
      ok: false,
      message: expect.stringContaining('delete_everything'),
    });
  });
});
