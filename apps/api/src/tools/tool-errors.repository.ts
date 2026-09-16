import { Inject, Injectable, Logger } from '@nestjs/common';
import { toolCallErrors } from '../db/schema';
import { DB, type Db } from '../db/tokens';
import type { ToolErrorLogPort, ToolErrorRecord } from './tool-error-log-port';

/**
 * How much of the model's arguments we keep.
 *
 * Long enough for the whole of a real tool call — a URL, a search query,
 * an email body a proposal was rejected for — and short enough that a model
 * emitting a megabyte of malformed JSON fills a column rather than a disk.
 * The truncation is visible in the stored value, so nobody reads a cut-off
 * argument as the whole of what the model sent.
 */
export const RAW_ARGUMENTS_MAX_CHARS = 2000;

/** Same idea, for our own sentence about the failure. */
export const DETAIL_MAX_CHARS = 1000;

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;
}

/**
 * Append-only writer for `tool_call_errors`, and the only implementation of
 * ToolErrorLogPort. No read path on purpose: nothing in the running app
 * needs to read this back, and a table nothing reads cannot be turned into
 * a way to get a stranger's arguments onto someone's screen. It is for
 * whoever is holding a psql prompt after a bad day.
 */
@Injectable()
export class ToolErrorsRepository implements ToolErrorLogPort {
  private readonly logger = new Logger(ToolErrorsRepository.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Never rejects — see ToolErrorLogPort. A failed insert is logged and
   * dropped: the exchange it belongs to has already gone wrong, and losing
   * the record of that is strictly better than losing the answer too.
   */
  async record(error: ToolErrorRecord): Promise<void> {
    try {
      await this.db.insert(toolCallErrors).values({
        messageId: error.messageId,
        accountId: error.accountId,
        toolName: error.toolName,
        failureKind: error.failureKind,
        rawArguments: clamp(error.rawArguments, RAW_ARGUMENTS_MAX_CHARS),
        detail: clamp(error.detail, DETAIL_MAX_CHARS),
      });
    } catch (err) {
      this.logger.warn(
        `Could not record a ${error.toolName} ${error.failureKind} failure: ${String(err)}`,
      );
    }
  }
}
