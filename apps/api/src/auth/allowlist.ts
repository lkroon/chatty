/**
 * Case-insensitive exact-match check against the `ALLOWED_EMAILS` env var
 * (a csv of full addresses). Read at call time, not module-load time, so
 * tests can set `process.env.ALLOWED_EMAILS` per case without needing to
 * re-import the module.
 */
export function isEmailAllowed(email: string): boolean {
  const raw = process.env.ALLOWED_EMAILS ?? '';
  const allowed = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return allowed.includes(email.trim().toLowerCase());
}
