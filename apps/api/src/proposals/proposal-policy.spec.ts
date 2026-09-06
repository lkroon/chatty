import {
  EXECUTING_STALE_MINUTES,
  EXECUTING_STALE_MS,
  RETRYABLE_KINDS,
  appTimeZone,
  proposalTtlDays,
  proposalTtlMs,
} from './proposal-policy';

describe('proposal-policy', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('defaults the TTL to 3 days', () => {
    delete process.env.PROPOSAL_TTL_DAYS;
    expect(proposalTtlDays()).toBe(3);
  });

  it('reads a configured TTL', () => {
    process.env.PROPOSAL_TTL_DAYS = '7';
    expect(proposalTtlDays()).toBe(7);
  });

  it('falls back to the default for a nonsense TTL rather than disabling expiry', () => {
    process.env.PROPOSAL_TTL_DAYS = 'soon';
    expect(proposalTtlDays()).toBe(3);
    process.env.PROPOSAL_TTL_DAYS = '0';
    expect(proposalTtlDays()).toBe(3);
  });

  it('expresses the TTL in milliseconds consistently', () => {
    process.env.PROPOSAL_TTL_DAYS = '2';
    expect(proposalTtlMs()).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it('keeps the stale window in both units', () => {
    expect(EXECUTING_STALE_MS).toBe(EXECUTING_STALE_MINUTES * 60 * 1000);
  });

  it('allows retrying only the kind that carries its own idempotency key', () => {
    expect(RETRYABLE_KINDS.has('calendar_event')).toBe(true);
    expect(RETRYABLE_KINDS.has('task')).toBe(false);
    expect(RETRYABLE_KINDS.has('email')).toBe(false);
  });

  it('defaults the timezone to Europe/Amsterdam', () => {
    delete process.env.BRIEFING_TIMEZONE;
    expect(appTimeZone()).toBe('Europe/Amsterdam');
    process.env.BRIEFING_TIMEZONE = 'Europe/Lisbon';
    expect(appTimeZone()).toBe('Europe/Lisbon');
  });
});
