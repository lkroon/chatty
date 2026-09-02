import 'express-session';

// A<->B seam (see main.ts): `accountId` is written once, here, on
// successful allowlisted login; workstream A reads it (never writes it)
// to key UsageService.consume(accountId). `authUser` is auth-module-only
// state backing GET /api/auth/me so it doesn't need a DB round trip or
// an extra `accounts` column for `picture`.
declare module 'express-session' {
  interface SessionData {
    accountId?: string;
    authUser?: {
      email: string;
      name: string;
      picture: string;
    };
  }
}

// Lets `req.user` (set by passport.authenticate's verify callback) carry
// our own shape without `any` casts in the controller.
declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      name: string;
      picture: string;
    }
  }
}

export {};
