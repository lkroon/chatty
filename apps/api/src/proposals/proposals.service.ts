import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ProposalCard } from '@contracts/proposal';
import { NotConnectedError } from '../google/errors';
import { GoogleConnectionsRepository } from '../google/google-connections.repository';
import { REQUIRED_SCOPE_BY_KIND } from '../google/google-oauth';
import { GoogleTokenService } from '../google/google-token.service';
import type { ProposalToolOutcome, ProposalToolPort } from '../tools/proposal-tool-port';
import { toProposalCard } from './proposal-card';
import { executeProposal } from './proposal-executors';
import { validateProposalArguments } from './proposal-payloads';
import { RETRYABLE_KINDS, appTimeZone } from './proposal-policy';
import { ProposalsRepository } from './proposals.repository';

const NOT_CONNECTED =
  'Google is not connected for this account. Connect it on Today and try again.';
const RECONNECT =
  'Google was connected before this permission existed. Disconnect and reconnect it on Today, then try again.';

/**
 * How many proposals may be awaiting a decision at once, across every
 * conversation.
 *
 * A tool call can only ever write a row, so the blast radius was already
 * bounded — but nothing stopped an injected model writing fifty of them and
 * burying Today's list under proposals the user never asked for. Refusing past
 * this point costs a well-behaved user nothing (nobody has ten real decisions
 * queued) and turns a denial-of-attention into a tool result the model must
 * explain to the user.
 */
const MAX_LIVE_PENDING = 10;

/**
 * Creates proposals (from a tool call) and executes them (from a user
 * confirmation). Those two paths never meet: the tool passes arguments and
 * gets back a card, and confirm takes nothing but an id.
 */
@Injectable()
export class ProposalsService implements ProposalToolPort {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    private readonly repository: ProposalsRepository,
    private readonly connections: GoogleConnectionsRepository,
    private readonly tokens: GoogleTokenService,
  ) {}

  async createFromToolCall(input: {
    accountId: number;
    conversationId: string;
    toolName: string;
    rawArguments: string;
  }): Promise<ProposalToolOutcome> {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(input.rawArguments);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, message: `${input.toolName}: arguments must be a JSON object.` };
      }
      args = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, message: `${input.toolName}: arguments were not valid JSON.` };
    }

    const validated = validateProposalArguments(input.toolName, args);
    if (validated.ok === false) {
      return validated;
    }

    // Checked after validation so a malformed call still gets the more useful
    // message, and before the insert so the cap actually caps.
    const live = await this.pendingForAccount(input.accountId);
    if (live.length >= MAX_LIVE_PENDING) {
      return {
        ok: false,
        message: `There are already ${live.length} proposals waiting for the user to confirm or discard, which is the maximum. Do not call this tool again. Tell the user to clear some of them on Today first.`,
      };
    }

    const created = await this.repository.create({
      accountId: input.accountId,
      conversationId: input.conversationId,
      kind: validated.kind,
      payload: validated.payload,
    });
    this.logger.log(`proposal ${created.id} (${created.kind}) created for account ${input.accountId}`);
    return { ok: true, card: toProposalCard(created) };
  }

  /**
   * Every proposal still awaiting a decision, as cards. The briefing calls
   * this so Today can list them (Task 21) — it is a read, and it deliberately
   * offers no way to act: confirming still goes through `confirm` below, from
   * the card in the transcript.
   *
   * Rows past their TTL come back from the repository as stored-pending and
   * are dropped here, because 'expired' is derived rather than written. That
   * means a lapsed proposal disappears from Today at the same moment its card
   * stops being confirmable, with no sweeper job to keep the two in step.
   */
  async pendingForAccount(accountId: number): Promise<ProposalCard[]> {
    const rows = await this.repository.findPendingForAccount(accountId);
    return rows.map((row) => toProposalCard(row)).filter((card) => card.confirmable);
  }

  /**
   * Executes the stored proposal `id` for `accountId`. Takes no payload: the
   * row is the only input, which is what makes the card and the executed
   * action provably the same thing.
   *
   * Step order matters. Ownership, confirmability, connection and scope are
   * all checked *before* the claim, and the access token is minted before it
   * too — so every one of those failures leaves the row pending and
   * retryable. Only once a token is in hand does the row move to 'executing'.
   */
  async confirm(accountId: number, id: string): Promise<ProposalCard> {
    const stored = await this.repository.findForAccount(id, accountId);
    if (!stored) {
      // Same 404 for "does not exist" and "belongs to someone else" — never
      // distinguish, or the endpoint becomes an id oracle.
      throw new NotFoundException('proposal not found');
    }

    const current = toProposalCard(stored);
    if (!current.confirmable) {
      throw new ConflictException(`This proposal can no longer be confirmed (${current.status}).`);
    }

    const connection = await this.connections.find(accountId);
    if (!connection) {
      throw new ConflictException(NOT_CONNECTED);
    }
    if (!connection.scopes.includes(REQUIRED_SCOPE_BY_KIND[stored.kind])) {
      throw new ConflictException(RECONNECT);
    }

    let accessToken: string;
    try {
      accessToken = await this.tokens.getAccessToken(accountId);
    } catch (err) {
      if (err instanceof NotConnectedError) {
        throw new ConflictException(NOT_CONNECTED);
      }
      throw err;
    }

    const claimed = await this.repository.claimForExecution({
      id,
      accountId,
      allowRetry: RETRYABLE_KINDS.has(stored.kind),
    });
    if (!claimed) {
      // Someone (or a second tap) got here first.
      throw new ConflictException('That proposal was already handled.');
    }

    try {
      const result = await executeProposal(claimed, accessToken, appTimeZone());
      const executed = await this.repository.markExecuted(id, result);
      this.logger.log(`proposal ${id} executed as ${result.externalId ?? 'unknown id'}`);
      return toProposalCard(executed ?? claimed);
    } catch (err) {
      // A failed write is a card state, not an HTTP error: the user needs to
      // see *which* proposal failed and why, in place.
      const message = (err as Error)?.message ?? 'Execution failed';
      this.logger.error(`proposal ${id} failed: ${message}`);
      const failed = await this.repository.markFailed(id, message);
      return toProposalCard(failed ?? claimed);
    }
  }

  async discard(accountId: number, id: string): Promise<ProposalCard> {
    const stored = await this.repository.findForAccount(id, accountId);
    if (!stored) {
      throw new NotFoundException('proposal not found');
    }
    const discarded = await this.repository.discard(id, accountId);
    if (!discarded) {
      throw new ConflictException('That proposal was already handled.');
    }
    return toProposalCard(discarded);
  }
}
