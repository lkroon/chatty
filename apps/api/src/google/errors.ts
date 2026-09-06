/**
 * The account has no usable Google connection — never granted, or the grant
 * was revoked. Callers render "connect your account" rather than an error.
 *
 * Its own file, with no imports, so both google-token.service.ts (which
 * throws it) and briefing/briefing.service.ts (which catches it) can depend
 * on it without depending on each other.
 */
export class NotConnectedError extends Error {
  constructor(message = 'no Google connection for this account') {
    super(message);
    this.name = 'NotConnectedError';
  }
}
