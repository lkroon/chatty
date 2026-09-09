import { Controller, Delete, Get, HttpCode, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { GoogleConnectionStatus } from '@contracts/briefing';
import { GoogleConnectionsRepository } from './google-connections.repository';
import { GoogleTokenService } from './google-token.service';
import { MAIL_ACTION_SCOPE, writeToolsEnabled } from './google-oauth';
import { requireAccountId } from './session-account';

/**
 * Normal `/api` routes — main.ts's setGlobalPrefix makes these
 * `/api/google/status` and `/api/google/connection`, and the global AuthGuard
 * covers them. requireAccountId() here is only for the numeric parse; the 401
 * has already happened by the time a handler runs.
 */
@Controller('google')
export class GoogleConnectionController {
  constructor(
    private readonly connections: GoogleConnectionsRepository,
    private readonly tokens: GoogleTokenService,
  ) {}

  @Get('status')
  async status(@Req() req: Request): Promise<GoogleConnectionStatus> {
    const accountId = requireAccountId(req);
    const connection = await this.connections.find(accountId);
    return connection
      ? {
          connected: true,
          scopes: connection.scopes,
          // Only a concern while the write tools are on: with them off the app
          // never asks for the scope, so a missing grant is correct, not stale.
          needsReconnect: writeToolsEnabled() && !connection.scopes.includes(MAIL_ACTION_SCOPE),
        }
      : { connected: false, scopes: [], needsReconnect: false };
  }

  @Delete('connection')
  @HttpCode(204)
  async disconnect(@Req() req: Request): Promise<void> {
    const accountId = requireAccountId(req);
    await this.connections.remove(accountId);
    this.tokens.forget(accountId);
  }
}
