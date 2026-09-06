import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ToolSource } from '@contracts/chat';

// Drizzle schema. Column names/types/constraints below must stay
// byte-for-byte identical to the frozen DDL in the Wave 1 plan — workstream
// B writes raw SQL against the same `accounts` shape independently, and
// both must agree once integrated. Do not "improve" naming or types here
// without updating the plan and workstream B.

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  googleSub: text('google_sub').unique(),
  provider: text('provider').notNull().default('google'),
});

export const conversations = pgTable('conversations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  accountId: integer('account_id').references(() => accounts.id),
  title: text('title'),
  model: text('model'),
  createdAt: timestamp('created_at', { withTimezone: true }).default(
    sql`now()`,
  ),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(
    sql`now()`,
  ),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    conversationId: uuid('conversation_id').references(
      () => conversations.id,
      { onDelete: 'cascade' },
    ),
    role: text('role'),
    content: text('content'),
    model: text('model'),
    finishReason: text('finish_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(
      sql`now()`,
    ),
    // Wave 1.5: summed `Number(cost)` from the upstream's trailing cost
    // frame(s) across every round of the exchange that produced this
    // (assistant) message. Null on user messages and on any exchange
    // where the upstream never reported one. Purely additive — see
    // message_tool_calls below for why this stays a one-way migration.
    upstreamCost: numeric('upstream_cost', { mode: 'number' }),
  },
  (table) => [
    check('messages_role_check', sql`${table.role} in ('user','assistant')`),
  ],
);

// Wave 1.5: the tool calls (web_search/web_fetch) an assistant message's
// exchange made, one row per call, in `ordinal` order. Tool results
// themselves are never stored here (or anywhere) — see the plan's "Tool
// results are ephemeral" note; `sources` holds ToolSource[] only (title +
// url), never page text or snippets.
export const messageToolCalls = pgTable(
  'message_tool_calls',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    label: text('label').notNull(),
    sources: jsonb('sources').$type<ToolSource[]>().notNull().default([]),
    // Wave 2: set only for the three write tools. ON DELETE SET NULL, not
    // CASCADE — deleting a proposal must not delete the transcript of the
    // message that proposed it.
    proposalId: uuid('proposal_id').references(() => proposals.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check('message_tool_calls_status_check', sql`${table.status} in ('done','failed')`),
    index('message_tool_calls_message_id_idx').on(table.messageId),
  ],
);

/**
 * The extra Google grant (Calendar + Gmail), one row per account. Separate
 * from `accounts` because logging in and connecting your calendar are
 * different consents: an account exists without this row, and revoking is a
 * DELETE here that leaves login working.
 *
 * `refreshTokenSealed` is AES-256-GCM output from src/google/token-crypto.ts,
 * never the raw token. Access tokens are deliberately NOT stored — they last
 * an hour and are minted on demand (src/google/google-token.service.ts).
 */
export const googleConnections = pgTable('google_connections', {
  accountId: integer('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  refreshTokenSealed: text('refresh_token_sealed').notNull(),
  scopes: text('scopes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/**
 * A write the model proposed and the user has not (yet) confirmed.
 *
 * This table is the entire blast radius of the write tools: a tool call can
 * insert a row here for its own account and can do nothing else. The Google
 * call happens in POST /api/proposals/:id/confirm, which re-reads the row by
 * id — so what the card renders is what gets executed.
 *
 * `payload` is one of the validated shapes in
 * src/proposals/proposal-payloads.ts. It is written once, by the tool, and
 * never updated: an edit would break the "the card and the executor read the
 * same row" property.
 *
 * There is deliberately no 'expired' status. Expiry is derived at read time
 * from `created_at` (see proposal-card.ts) so no scheduled job is needed.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    // Nullable: the conversation may be deleted while a proposal is still
    // pending, and that must not delete the record of what was executed.
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    /** Google's id for the created item. Null until executed. */
    externalId: text('external_id'),
    /** Google's web link to the created item, when it returns one. */
    externalLink: text('external_link'),
    /** Why execution failed. Never carries a Google response body. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      'proposals_kind_check',
      sql`${table.kind} in ('calendar_event','task','email')`,
    ),
    check(
      'proposals_status_check',
      sql`${table.status} in ('pending','executing','executed','discarded','failed')`,
    ),
    index('proposals_account_id_status_idx').on(table.accountId, table.status),
  ],
);

export const usageCounters = pgTable(
  'usage_counters',
  {
    accountId: integer('account_id').references(() => accounts.id),
    day: date('day'),
    messageCount: integer('message_count'),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.day] })],
);
