/** BullMQ queue that applies index mutations off the request path. */
export const SEARCH_INDEXING_QUEUE = 'search-indexing';

/** Job: add-or-replace documents in an index. */
export const SEARCH_INDEX_DOCS_JOB = 'index-docs';

/** Job: delete documents by id from an index. */
export const SEARCH_DELETE_DOCS_JOB = 'delete-docs';

/** Job: rebuild an index from its registered source. */
export const SEARCH_REINDEX_JOB = 'reindex';

/** DI token carrying the app's registered index definitions. */
export const SEARCH_INDEX_DEFINITIONS = Symbol('SEARCH_INDEX_DEFINITIONS');
