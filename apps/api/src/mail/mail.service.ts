import { ForbiddenException, Injectable } from '@nestjs/common';
import { GoogleConnectionsRepository } from '../google/google-connections.repository';
import { GoogleTokenService } from '../google/google-token.service';
import { NotConnectedError } from '../google/errors';
import { MAIL_ACTION_SCOPE } from '../google/google-oauth';
import { archiveMessage, markMessageRead } from './gmail-actions';

@Injectable()
export class MailService {
  constructor(
    private readonly tokens: GoogleTokenService,
    private readonly connections: GoogleConnectionsRepository,
  ) {}

  async markRead(accountId: number, messageId: string): Promise<void> {
    await markMessageRead(await this.authorize(accountId), messageId);
  }

  async archive(accountId: number, messageId: string): Promise<void> {
    await archiveMessage(await this.authorize(accountId), messageId);
  }

  /**
   * Scope first, token second — the same order ProposalsService uses. An
   * account that connected before gmail.modify existed must get a signal it
   * can act on ("reconnect Google"), not a 403 minted by Google.
   */
  private async authorize(accountId: number): Promise<string> {
    const connection = await this.connections.find(accountId);
    if (!connection) {
      throw new ForbiddenException('google_not_connected');
    }
    if (!connection.scopes.includes(MAIL_ACTION_SCOPE)) {
      throw new ForbiddenException('google_scope_missing');
    }
    try {
      return await this.tokens.getAccessToken(accountId);
    } catch (err) {
      if (err instanceof NotConnectedError) {
        throw new ForbiddenException('google_not_connected');
      }
      throw err;
    }
  }
}
