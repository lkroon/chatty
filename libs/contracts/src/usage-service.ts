/**
 * A↔C seam: workstream C implements this (backed by the daily message
 * cap / DB), workstream A calls it from the chat controller keyed by
 * `req.session.accountId`. Neither workstream reaches into the other's
 * internals beyond this interface.
 */
export interface UsageService {
  consume(
    accountId: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'LIMIT_EXCEEDED' }>;
}
