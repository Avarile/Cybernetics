/** BullMQ queue that applies index mutations off the request path. */
export const SEARCH_INDEXING_QUEUE = 'search-indexing';

/** Job: sync a single record (by id) to Meili — add/replace, or delete if the row is soft-deleted. */
export const INDEX_RECORD_JOB = 'index-record';

/** Job: delete a record's document from a collection's index. */
export const DELETE_RECORD_JOB = 'delete-record';

/** Job: clear a collection's index and reload every live record from Postgres. */
export const REINDEX_COLLECTION_JOB = 'reindex-collection';

/** Job: sweep for records that never converged and re-enqueue them. */
export const RECONCILE_JOB = 'reconcile';

/** A record must be un-synced for at least this long before reconciliation retries it. */
export const RECONCILE_STALE_MS = 300_000; // 5 minutes
