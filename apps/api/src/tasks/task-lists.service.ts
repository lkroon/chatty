import { Injectable, Logger } from '@nestjs/common';
import { GoogleTokenService } from '../google/google-token.service';
import { NotConnectedError } from '../google/errors';
import { fetchTaskLists, type TaskList } from './task-lists';

/**
 * How long a fetched set of lists is reused for one account.
 *
 * Short on purpose: a list the user just made in the Google Tasks app has to
 * become nameable in chat without them wondering why it is not there yet.
 * A stale window is harmless — the fallback is the default list, never a
 * failure — and anything chatty creates itself invalidates immediately.
 */
export const LIST_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  lists: TaskList[];
  expiresAt: number;
}

/**
 * The account's task lists, cached.
 *
 * Three callers want the same answer within one exchange — the chat prompt
 * (so the model knows which categories exist), the proposal resolver (so a
 * spoken name becomes a list id) and the briefing (so Today can read every
 * list) — and none of them should cost a separate round trip to Google.
 */
@Injectable()
export class TaskListsService {
  private readonly logger = new Logger(TaskListsService.name);
  private readonly cache = new Map<number, CacheEntry>();

  constructor(private readonly tokens: GoogleTokenService) {}

  /** Every list on the account. Throws if Google does — the caller decides what that costs. */
  async lists(accountId: number, now = Date.now()): Promise<TaskList[]> {
    const cached = this.cache.get(accountId);
    if (cached && cached.expiresAt > now) {
      return cached.lists;
    }

    const accessToken = await this.tokens.getAccessToken(accountId);
    const lists = await fetchTaskLists(accessToken);
    this.cache.set(accountId, { lists, expiresAt: now + LIST_CACHE_TTL_MS });
    return lists;
  }

  /**
   * List names for the system prompt, or an empty array when there are none
   * to be had.
   *
   * Never throws: not being able to name the user's categories is a worse
   * prompt, not a failed exchange, and the resolver still matches whatever
   * the model says against the real lists before anything is written.
   */
  async titlesForPrompt(accountId: number): Promise<string[]> {
    try {
      return (await this.lists(accountId)).map((list) => list.title);
    } catch (err) {
      if (!(err instanceof NotConnectedError)) {
        this.logger.warn(
          `Could not read task lists for account ${accountId}: ${(err as Error).message}`,
        );
      }
      return [];
    }
  }

  /** Drops the cached lists, so the next read sees a list chatty just created. */
  invalidate(accountId: number): void {
    this.cache.delete(accountId);
  }
}
