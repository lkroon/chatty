import { calendarEventId, createCalendarEvent } from './calendar-writer';
import type { CalendarEventPayload } from './proposal-payloads';

const PROPOSAL_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const payload: CalendarEventPayload = {
  title: 'Dentist',
  start: '2026-09-08T15:00:00',
  end: '2026-09-08T15:45:00',
  location: 'Kerkstraat 1',
  description: null,
};

describe('calendarEventId', () => {
  it('strips the hyphens from a uuid', () => {
    expect(calendarEventId(PROPOSAL_ID)).toBe('3f2504e04f8911d39a0c0305e82c3301');
  });

  it('rejects an id that is not valid base32hex for Calendar', () => {
    // Calendar event ids allow only characters a-v and 0-9; 'z' and 'x' are
    // out of range, and a rejected id is far better than a 400 at send time.
    expect(() => calendarEventId('zzzzz')).toThrow(/event id/);
  });
});

describe('createCalendarEvent', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the event with the supplied timezone and the proposal id', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return new Response(JSON.stringify({ id: 'evt-1', htmlLink: 'https://cal/evt-1' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const result = await createCalendarEvent(
      'at-1',
      payload,
      PROPOSAL_ID,
      'Europe/Amsterdam',
    );

    expect(seenUrl).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(seenInit!.method).toBe('POST');
    expect((seenInit!.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
    expect(JSON.parse(String(seenInit!.body))).toEqual({
      id: '3f2504e04f8911d39a0c0305e82c3301',
      summary: 'Dentist',
      location: 'Kerkstraat 1',
      start: { dateTime: '2026-09-08T15:00:00', timeZone: 'Europe/Amsterdam' },
      end: { dateTime: '2026-09-08T15:45:00', timeZone: 'Europe/Amsterdam' },
    });
    expect(result).toEqual({ externalId: 'evt-1', link: 'https://cal/evt-1' });
  });

  it('omits absent optional fields rather than sending nulls', async () => {
    let body: Record<string, unknown> = {};
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'evt-2' }), { status: 200 });
    }) as unknown as typeof fetch;

    await createCalendarEvent(
      'at-1',
      { ...payload, location: null, description: null },
      PROPOSAL_ID,
      'Europe/Amsterdam',
    );

    expect('location' in body).toBe(false);
    expect('description' in body).toBe(false);
  });

  it('returns no link when Google omits one', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ id: 'evt-3' }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      createCalendarEvent('at-1', payload, PROPOSAL_ID, 'Europe/Amsterdam'),
    ).resolves.toEqual({ externalId: 'evt-3', link: null });
  });

  it('treats a 409 as already created — the retry is idempotent', async () => {
    global.fetch = jest.fn(async () =>
      new Response('{"error":{"message":"The requested identifier already exists."}}', {
        status: 409,
      }),
    ) as unknown as typeof fetch;

    await expect(
      createCalendarEvent('at-1', payload, PROPOSAL_ID, 'Europe/Amsterdam'),
    ).resolves.toEqual({ externalId: '3f2504e04f8911d39a0c0305e82c3301', link: null });
  });

  it('throws on another failure without echoing the response body', async () => {
    global.fetch = jest.fn(async () =>
      new Response('{"error":{"message":"secret detail"}}', { status: 403 }),
    ) as unknown as typeof fetch;

    await expect(
      createCalendarEvent('at-1', payload, PROPOSAL_ID, 'Europe/Amsterdam'),
    ).rejects.toThrow('Calendar create failed (403)');
  });
});
