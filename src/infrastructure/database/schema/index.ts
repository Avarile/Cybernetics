/**
 * Drizzle schema barrel.
 *
 * Re-export every table module here so the typed `db`
 * (`NodePgDatabase<typeof schema>`) and drizzle-kit both see the full schema.
 * Use `baseColumns` from `./common` for the shared id + timestamp columns.
 *
 * Example:
 *   export * from './user.schema';
 */
export * from './file.schema';
export * from './identity.schema';
