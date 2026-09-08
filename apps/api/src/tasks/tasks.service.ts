import { ForbiddenException, Injectable } from '@nestjs/common';
import { GoogleConnectionsRepository } from '../google/google-connections.repository';
import { GoogleTokenService } from '../google/google-token.service';
import { NotConnectedError } from '../google/errors';
import { completeTask } from './tasks-actions';

/** The scope a task write needs. Already in WRITE_SCOPES — see google-oauth.ts. */
const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

@Injectable()
export class TasksService {
  constructor(
    private readonly tokens: GoogleTokenService,
    private readonly connections: GoogleConnectionsRepository,
  ) {}

  /**
   * The scope check comes before the token, exactly as ProposalsService does
   * it: an account that connected Google before the write scopes existed must
   * get a "reconnect Google" signal, not an opaque 403 from Google itself.
   */
  async complete(accountId: number, taskId: string): Promise<void> {
    const connection = await this.connections.find(accountId);
    if (!connection) {
      throw new ForbiddenException('google_not_connected');
    }
    if (!connection.scopes.includes(TASKS_SCOPE)) {
      throw new ForbiddenException('google_scope_missing');
    }

    let accessToken: string;
    try {
      accessToken = await this.tokens.getAccessToken(accountId);
    } catch (err) {
      if (err instanceof NotConnectedError) {
        throw new ForbiddenException('google_not_connected');
      }
      throw err;
    }

    await completeTask(accessToken, taskId);
  }
}
