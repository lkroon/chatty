import { randomBytes } from 'node:crypto';
import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleConnectionsRepository } from './google-connections.repository';
import { GoogleTokenService } from './google-token.service';
import { buildConsentUrl, exchangeCodeForTokens } from './google-oauth';
import { requireAccountId } from './session-account';
import { encryptToken, requireEncryptionKey } from './token-crypto';

/**
 * The second, opt-in Google grant.
 *
 * `@Controller('auth/google')` mirrors auth.controller.ts's `@Controller('auth')`:
 * main.ts excludes `/auth/{*splat}` from the `/api` prefix, so these resolve to
 * `/auth/google/connect` and `/auth/google/connect/callback`.
 *
 * That same prefix is what auth.guard.ts:34 waves through without a session —
 * the bypass is for the pre-login OAuth endpoints, and it applies to these too.
 * Hence requireAccountId() in both handlers: an unauthenticated caller must not
 * be able to start a grant.
 */
@Controller('auth/google')
export class GoogleConnectController {
  private readonly logger = new Logger(GoogleConnectController.name);

  constructor(
    private readonly connections: GoogleConnectionsRepository,
    private readonly tokens: GoogleTokenService,
  ) {}

  @Get('connect')
  start(@Req() req: Request, @Res() res: Response): void {
    const accountId = requireAccountId(req);
    // CSRF: Google echoes `state` back on the callback. Without comparing it
    // to a value we generated, an attacker could feed us their own code and
    // bind their Google account to this session.
    const state = randomBytes(24).toString('hex');
    req.session.googleConnectState = state;
    this.logger.log(`starting Google connect for account ${accountId}`);
    res.redirect(buildConsentUrl(state));
  }

  @Get('connect/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    const origin = process.env.APP_ORIGIN ?? '';
    const accountId = requireAccountId(req);
    const expected = req.session.googleConnectState;
    req.session.googleConnectState = undefined;

    if (!code || !state || !expected || state !== expected) {
      this.logger.warn(`Google connect callback rejected for account ${accountId} (bad state)`);
      res.redirect(`${origin}/?connect=failed`);
      return;
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      await this.connections.upsert(
        accountId,
        encryptToken(tokens.refreshToken, requireEncryptionKey()),
        tokens.scopes,
      );
      this.tokens.forget(accountId);
      this.logger.log(`Google connected for account ${accountId}`);
      res.redirect(`${origin}/?connect=ok`);
    } catch (err) {
      // Never include the error body: it can carry the authorization code.
      this.logger.error(`Google connect failed for account ${accountId}: ${(err as Error).name}`);
      res.redirect(`${origin}/?connect=failed`);
    }
  }
}
