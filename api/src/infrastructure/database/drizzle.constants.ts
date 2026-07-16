import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

/** DI token for the underlying pg connection pool. */
export const PG_POOL = Symbol('PG_POOL');

/** DI token for the Drizzle database instance. */
export const DRIZZLE = Symbol('DRIZZLE');

/** Strongly-typed Drizzle database, aware of the full schema. */
export type DrizzleDB = NodePgDatabase<typeof schema>;
