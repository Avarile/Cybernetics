/** BullMQ queue that runs inbound-mail sync off the request path. */
export const MAILBOX_SYNC_QUEUE = 'mailbox-sync';

/** Job: pull new messages for one (accountId, mailbox) into the store. */
export const SYNC_MAILBOX_JOB = 'sync-mailbox';

/** The system-owned MeiliSearch collection inbound mail is indexed into. */
export const INBOUND_EMAIL_COLLECTION = 'inbound_email';

/** Shared BullMQ options for sync jobs: bounded retries, self-cleaning. */
export const SYNC_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;
