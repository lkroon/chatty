import 'express-session';

// CSRF state for the opt-in Google connect flow (google-connect.controller.ts).
// Written when the consent redirect is issued, compared and cleared on the
// callback. Declared here, not in another module's .d.ts, so this module owns
// the field it introduced — ambient module augmentation merges globally.
declare module 'express-session' {
  interface SessionData {
    googleConnectState?: string;
  }
}

export {};
