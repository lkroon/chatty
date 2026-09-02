import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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
  },
  (table) => [
    check('messages_role_check', sql`${table.role} in ('user','assistant')`),
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
