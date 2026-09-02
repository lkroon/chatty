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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check('message_tool_calls_status_check', sql`${table.status} in ('done','failed')`),
    index('message_tool_calls_message_id_idx').on(table.messageId),
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
