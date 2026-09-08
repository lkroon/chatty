import type { BriefingItems } from '@contracts';

import {
  BRIEFING_CACHE_KEY,
  clearBriefingCache,
  itemFingerprint,
  readBriefingCache,
  writeBriefingCache,
} from './briefing-cache';

function items(overrides: Partial<BriefingItems> = {}): BriefingItems {
  return {
    date: '2026-09-08',
    timeZone: 'Europe/Amsterdam',
    calendar: { status: 'ok', items: [] },
    tasks: { status: 'ok', items: [] },
    mail: { status: 'ok', items: [] },
    mailHasMore: false,
    pending: [],
    generatedAt: '2026-09-08T06:00:00.000Z',
    ...overrides,
  };
}

describe('briefing-cache', () => {
  beforeEach(() => localStorage.removeItem(BRIEFING_CACHE_KEY));
  afterEach(() => localStorage.removeItem(BRIEFING_CACHE_KEY));

  it('round-trips a cached briefing', () => {
    writeBriefingCache({
      items: items(),
      summary: 'A quiet day.',
      summaryFingerprint: 'fp',
      dismissedTaskIds: ['t9'],
      cachedAt: 1000,
    });
    const read = readBriefingCache('2026-09-08', 2000);
    expect(read?.summary).toBe('A quiet day.');
    expect(read?.dismissedTaskIds).toEqual(['t9']);
  });

  it('discards a cache older than 24 hours', () => {
    writeBriefingCache({
      items: items(),
      summary: 's',
      summaryFingerprint: 'fp',
      dismissedTaskIds: [],
      cachedAt: 0,
    });
    expect(readBriefingCache('2026-09-08', 25 * 60 * 60 * 1000)).toBeNull();
  });

  it('discards a cache from another day', () => {
    writeBriefingCache({
      items: items({ date: '2026-09-07' }),
      summary: 's',
      summaryFingerprint: 'fp',
      dismissedTaskIds: [],
      cachedAt: 1000,
    });
    expect(readBriefingCache('2026-09-08', 2000)).toBeNull();
  });

  it('returns null rather than throwing on corrupt stored data', () => {
    localStorage.setItem(BRIEFING_CACHE_KEY, 'not json');
    expect(readBriefingCache('2026-09-08', 2000)).toBeNull();
  });

  it('clears the cache', () => {
    writeBriefingCache({
      items: items(),
      summary: 's',
      summaryFingerprint: 'fp',
      dismissedTaskIds: [],
      cachedAt: 1000,
    });
    clearBriefingCache();
    expect(readBriefingCache('2026-09-08', 2000)).toBeNull();
  });

  it('ignores generatedAt when fingerprinting', () => {
    const a = itemFingerprint(items({ generatedAt: '2026-09-08T06:00:00.000Z' }));
    const b = itemFingerprint(items({ generatedAt: '2026-09-08T09:30:00.000Z' }));
    expect(a).toBe(b);
  });

  it('changes the fingerprint when an item appears', () => {
    const before = itemFingerprint(items());
    const after = itemFingerprint(
      items({
        mail: {
          status: 'ok',
          items: [{ id: 'm1', from: 'a', subject: 's', snippet: '', receivedAt: '' }],
        },
      }),
    );
    expect(before).not.toBe(after);
  });

  it('is order-independent within a section', () => {
    const one = itemFingerprint(
      items({
        tasks: {
          status: 'ok',
          items: [
            { id: 'a', title: 'A', due: '2026-09-08', overdue: false, notes: null },
            { id: 'b', title: 'B', due: '2026-09-08', overdue: false, notes: null },
          ],
        },
      }),
    );
    const two = itemFingerprint(
      items({
        tasks: {
          status: 'ok',
          items: [
            { id: 'b', title: 'B', due: '2026-09-08', overdue: false, notes: null },
            { id: 'a', title: 'A', due: '2026-09-08', overdue: false, notes: null },
          ],
        },
      }),
    );
    expect(one).toBe(two);
  });
});
