import { fetchAgendaEvents } from './calendar-source';

describe('fetchAgendaEvents', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(body: unknown, status = 200): jest.Mock {
    const mock = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it('requests a single-event, time-ordered window and sends the bearer token', async () => {
    const mock = respondWith({ items: [] });
    await fetchAgendaEvents('at-1', '2026-09-05', 'Europe/Amsterdam');

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(parsed.searchParams.get('singleEvents')).toBe('true');
    expect(parsed.searchParams.get('timeZone')).toBe('Europe/Amsterdam');
    expect(parsed.searchParams.get('orderBy')).toBe('startTime');
    expect(parsed.searchParams.get('timeMin')).toBe('2026-09-05T00:00:00+02:00');
    expect(parsed.searchParams.get('timeMax')).toBe('2026-09-08T00:00:00+02:00');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  it('uses the correct offset on both sides of a DST transition', async () => {
    const mock = respondWith({ items: [] });
    await fetchAgendaEvents('at', '2026-10-24', 'Europe/Amsterdam');
    const [url] = mock.mock.calls[0] as [string];
    const parsed = new URL(url);
    // The window opens before the transition and closes after it.
    expect(parsed.searchParams.get('timeMin')).toBe('2026-10-24T00:00:00+02:00');
    expect(parsed.searchParams.get('timeMax')).toBe('2026-10-27T00:00:00+01:00');
  });

  it('maps a timed event', async () => {
    respondWith({
      items: [
        {
          id: 'e1',
          summary: 'Standup',
          location: 'Office',
          start: { dateTime: '2026-09-05T09:00:00+02:00' },
          end: { dateTime: '2026-09-05T09:15:00+02:00' },
        },
      ],
    });
    await expect(fetchAgendaEvents('at', '2026-09-05', 'Europe/Amsterdam')).resolves.toEqual([
      {
        id: 'e1',
        title: 'Standup',
        date: '2026-09-05',
        start: '2026-09-05T09:00:00+02:00',
        end: '2026-09-05T09:15:00+02:00',
        allDay: false,
        location: 'Office',
      },
    ]);
  });

  it('maps an all-day event', async () => {
    respondWith({
      items: [{ id: 'e2', summary: 'Holiday', start: { date: '2026-09-05' }, end: { date: '2026-09-06' } }],
    });
    const [event] = await fetchAgendaEvents('at', '2026-09-05', 'Europe/Amsterdam');
    expect(event).toEqual({
      id: 'e2',
      title: 'Holiday',
      date: '2026-09-05',
      start: null,
      end: null,
      allDay: true,
      location: null,
    });
  });

  it('dates an event by the local day it starts on', async () => {
    respondWith({
      items: [
        { id: 'e1', summary: 'Today', start: { dateTime: '2026-09-05T09:00:00+02:00' } },
        { id: 'e2', summary: 'Friday', start: { dateTime: '2026-09-07T10:00:00+02:00' } },
        { id: 'e3', summary: 'All week', start: { date: '2026-09-01' }, end: { date: '2026-09-09' } },
      ],
    });
    const events = await fetchAgendaEvents('at', '2026-09-05', 'Europe/Amsterdam');
    // The multi-day event began before the window, so it is clamped onto its
    // first day rather than dated to a day the agenda never renders.
    expect(events.map((e) => [e.id, e.date])).toEqual([
      ['e1', '2026-09-05'],
      ['e2', '2026-09-07'],
      ['e3', '2026-09-05'],
    ]);
  });

  it('substitutes a placeholder title for an untitled event', async () => {
    respondWith({ items: [{ id: 'e3', start: { dateTime: '2026-09-05T09:00:00+02:00' } }] });
    const [event] = await fetchAgendaEvents('at', '2026-09-05', 'Europe/Amsterdam');
    expect(event.title).toBe('(no title)');
  });

  it('drops cancelled events', async () => {
    respondWith({
      items: [
        { id: 'e4', summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-09-05T09:00:00+02:00' } },
      ],
    });
    await expect(fetchAgendaEvents('at', '2026-09-05', 'Europe/Amsterdam')).resolves.toEqual([]);
  });

  it('throws on a non-200 without echoing the body', async () => {
    respondWith({ error: { message: 'nope' } }, 403);
    await expect(fetchAgendaEvents('at', '2026-09-05', 'Europe/Amsterdam')).rejects.toThrow(
      /Calendar request failed \(403\)/,
    );
  });

  it('tolerates a response with no items array', async () => {
    respondWith({});
    await expect(fetchAgendaEvents('at', '2026-09-05', 'Europe/Amsterdam')).resolves.toEqual([]);
  });
});
