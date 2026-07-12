import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Reusable column set replacing the old TypeORM `BaseEntity`: a UUID primary
 * key plus audit timestamps. Spread into a table definition:
 *
 *   export const users = pgTable('users', {
 *     ...baseColumns,
 *     email: varchar('email', { length: 255 }).notNull().unique(),
 *   });
 */
export const baseColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
