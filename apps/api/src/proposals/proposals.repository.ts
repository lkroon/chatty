import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, eq, inArray, or, sql } from 'drizzle-orm';
import type { ProposalKind } from '@contracts/proposal';
import { proposals } from '../db/schema';
import { DB, type Db } from '../db/tokens';
import type { ProposalPayload, WriteResult } from './proposal-payloads';
import { EXECUTING_STALE_MINUTES, proposalTtlDays } from './proposal-policy';
import type { ProposalRow, StoredProposalStatus } from './proposal-row';

const ERROR_MAX_CHARS = 500;

interface DbProposal {
  id: string;
  accountId: number;
  conversationId: string | null;
  kind: string;
  payload: unknown;
  status: string;
  externalId: string | null;
  externalLink: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRow(row: DbProposal): ProposalRow {
  return {
    id: row.id,
    accountId: row.accountId,
    conversationId: row.conversationId,
    kind: row.kind as ProposalKind,
    payload: row.payload as ProposalPayload,
    status: row.status as StoredProposalStatus,
    externalId: row.externalId,
    externalLink: row.externalLink,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Every statement about a proposal row.
 *
 * `claimForExecution` is the important one: it is the single-use gate that
 * makes a double-tapped Confirm, a retried request, or a reconnecting client
 * harmless. It moves the row to 'executing' and returns it only if the row is
 * still claimable *in the same statement* — checking first and updating after
 * would race with itself.
 */
@Injectable()
export class ProposalsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(input: {
    accountId: number;
    conversationId: string | null;
    kind: ProposalKind;
    payload: ProposalPayload;
  }): Promise<ProposalRow> {
    const [row] = await this.db
      .insert(proposals)
      .values({
        accountId: input.accountId,
        conversationId: input.conversationId,
        kind: input.kind,
        payload: input.payload,
        status: 'pending',
      })
      .returning();
    return mapRow(row as DbProposal);
  }

  async findForAccount(id: string, accountId: number): Promise<ProposalRow | null> {
    const rows = await this.db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.accountId, accountId)))
      .limit(1);
    return rows[0] ? mapRow(rows[0] as DbProposal) : null;
  }

  /**
   * Every row still awaiting a decision, oldest first — the one closest to
   * expiring is the one worth showing first. Filters on the stored status
   * only; whether a row is *actually* still live is toProposalCard's call,
   * because the TTL is derived and not in the table. The caller drops
   * anything that comes back 'expired'.
   */
  async findPendingForAccount(accountId: number): Promise<ProposalRow[]> {
    const rows = await this.db
      .select()
      .from(proposals)
      .where(and(eq(proposals.accountId, accountId), eq(proposals.status, 'pending')))
      .orderBy(proposals.createdAt);
    return rows.map((row) => mapRow(row as DbProposal));
  }

  /** One query for a whole conversation's chips — never one query per chip. */
  async findManyByIds(ids: string[]): Promise<ProposalRow[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db.select().from(proposals).where(inArray(proposals.id, ids));
    return rows.map((row) => mapRow(row as DbProposal));
  }

  async claimForExecution(input: {
    id: string;
    accountId: number;
    allowRetry: boolean;
  }): Promise<ProposalRow | null> {
    const claimable: (SQL | undefined)[] = [eq(proposals.status, 'pending')];
    if (input.allowRetry) {
      claimable.push(eq(proposals.status, 'failed'));
      claimable.push(
        and(
          eq(proposals.status, 'executing'),
          sql`${proposals.updatedAt} < now() - make_interval(mins => ${EXECUTING_STALE_MINUTES})`,
        ),
      );
    }

    const rows = await this.db
      .update(proposals)
      .set({ status: 'executing', error: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(proposals.id, input.id),
          eq(proposals.accountId, input.accountId),
          // TTL is enforced here as well as on the card: the card stops the
          // button appearing, this stops a hand-made request going through.
          sql`${proposals.createdAt} > now() - make_interval(days => ${proposalTtlDays()})`,
          or(...claimable),
        ),
      )
      .returning();

    return rows[0] ? mapRow(rows[0] as DbProposal) : null;
  }

  async markExecuted(id: string, result: WriteResult): Promise<ProposalRow | null> {
    const rows = await this.db
      .update(proposals)
      .set({
        status: 'executed',
        externalId: result.externalId,
        externalLink: result.link,
        error: null,
        updatedAt: sql`now()`,
      })
      .where(eq(proposals.id, id))
      .returning();
    return rows[0] ? mapRow(rows[0] as DbProposal) : null;
  }

  async markFailed(id: string, message: string): Promise<ProposalRow | null> {
    const rows = await this.db
      .update(proposals)
      .set({
        status: 'failed',
        error: message.slice(0, ERROR_MAX_CHARS),
        updatedAt: sql`now()`,
      })
      .where(eq(proposals.id, id))
      .returning();
    return rows[0] ? mapRow(rows[0] as DbProposal) : null;
  }

  async discard(id: string, accountId: number): Promise<ProposalRow | null> {
    const rows = await this.db
      .update(proposals)
      .set({ status: 'discarded', updatedAt: sql`now()` })
      .where(
        and(
          eq(proposals.id, id),
          eq(proposals.accountId, accountId),
          or(eq(proposals.status, 'pending'), eq(proposals.status, 'failed')),
        ),
      )
      .returning();
    return rows[0] ? mapRow(rows[0] as DbProposal) : null;
  }
}
