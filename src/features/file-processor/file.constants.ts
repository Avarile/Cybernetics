/** BullMQ queue that runs post-upload processing + reconciliation. */
export const FILE_PROCESSING_QUEUE = 'file-processing';

/** Job: verify/backfill checksum + magic-byte check for a single file. */
export const FILE_PROCESS_JOB = 'process-file';

/** Job: repeatable sweep that expires stale uploads and purges orphans. */
export const FILE_RECONCILE_JOB = 'reconcile-files';
