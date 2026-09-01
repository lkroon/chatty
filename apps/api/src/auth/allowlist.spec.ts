import { isEmailAllowed } from './allowlist';

describe('isEmailAllowed', () => {
  const original = process.env.ALLOWED_EMAILS;

  afterEach(() => {
    process.env.ALLOWED_EMAILS = original;
  });

  it('matches an exact address in the csv', () => {
    process.env.ALLOWED_EMAILS = 'alice@example.com,bob@example.com';
    expect(isEmailAllowed('alice@example.com')).toBe(true);
    expect(isEmailAllowed('bob@example.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    process.env.ALLOWED_EMAILS = 'Alice@Example.com';
    expect(isEmailAllowed('alice@example.com')).toBe(true);
    expect(isEmailAllowed('ALICE@EXAMPLE.COM')).toBe(true);
  });

  it('tolerates whitespace around csv entries', () => {
    process.env.ALLOWED_EMAILS = ' alice@example.com , bob@example.com ';
    expect(isEmailAllowed('alice@example.com')).toBe(true);
    expect(isEmailAllowed('bob@example.com')).toBe(true);
  });

  it('rejects an address not in the list', () => {
    process.env.ALLOWED_EMAILS = 'alice@example.com';
    expect(isEmailAllowed('mallory@example.com')).toBe(false);
  });

  it('rejects a non-exact (substring/domain) match', () => {
    process.env.ALLOWED_EMAILS = 'alice@example.com';
    expect(isEmailAllowed('alice@example.com.evil.com')).toBe(false);
    expect(isEmailAllowed('notalice@example.com')).toBe(false);
  });

  it('rejects everything when unset', () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isEmailAllowed('alice@example.com')).toBe(false);
  });
});
