import 'express-session';

// A<->B seam (see libs/contracts/src/usage-service.ts and main.ts):
// workstream B writes the authenticated account's id onto the session as
// `req.session.accountId` after login. This module and workstream A both
// only read it. Declared here (ambient module augmentation merges
// globally) so this module's controllers get a typed `req.session`
// without depending on workstream B's files existing yet.
declare module 'express-session' {
  interface SessionData {
    accountId?: string;
  }
}
