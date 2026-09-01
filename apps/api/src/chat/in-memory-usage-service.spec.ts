import { InMemoryUsageService } from './in-memory-usage-service';

describe('InMemoryUsageService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows consumption up to DAILY_MESSAGE_LIMIT then rejects with LIMIT_EXCEEDED', async () => {
    process.env.DAILY_MESSAGE_LIMIT = '2';
    const service = new InMemoryUsageService();

    expect(await service.consume('acct-1')).toEqual({ ok: true });
    expect(await service.consume('acct-1')).toEqual({ ok: true });
    expect(await service.consume('acct-1')).toEqual({
      ok: false,
      reason: 'LIMIT_EXCEEDED',
    });
  });

  it('tracks separate counters per account', async () => {
    process.env.DAILY_MESSAGE_LIMIT = '1';
    const service = new InMemoryUsageService();

    expect(await service.consume('acct-1')).toEqual({ ok: true });
    expect(await service.consume('acct-2')).toEqual({ ok: true });
    expect(await service.consume('acct-1')).toEqual({
      ok: false,
      reason: 'LIMIT_EXCEEDED',
    });
  });

  it('defaults to a limit of 200 when DAILY_MESSAGE_LIMIT is unset', async () => {
    delete process.env.DAILY_MESSAGE_LIMIT;
    const service = new InMemoryUsageService();

    for (let i = 0; i < 200; i++) {
      expect(await service.consume('acct-1')).toEqual({ ok: true });
    }
    expect(await service.consume('acct-1')).toEqual({
      ok: false,
      reason: 'LIMIT_EXCEEDED',
    });
  });
});
