import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

// DI tokens for the raw pg Pool and the drizzle database instance,
// provided by DbModule. Symbols (not classes/interfaces) because both are
// third-party types.
export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

export type Db = NodePgDatabase<typeof schema>;
