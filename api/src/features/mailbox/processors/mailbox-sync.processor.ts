import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { MailboxIngestService } from '../mailbox-ingest.service';
import {
  MAILBOX_SYNC_QUEUE,
  SYNC_JOB_OPTS,
  SYNC_MAILBOX_JOB,
} from '../mailbox.constants';

interface SyncJobData {
  accountId: string;
  mailbox: string;
}

/** Consumes `sync-mailbox`: ingest one batch, then continue if the batch was full. */
@Processor(MAILBOX_SYNC_QUEUE)
export class MailboxSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MailboxSyncProcessor.name);

  constructor(
    private readonly ingest: MailboxIngestService,
    @InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== SYNC_MAILBOX_JOB) {
      this.logger.warn(`Unknown job "${job.name}"`);
      return;
    }
    const { accountId, mailbox } = job.data as SyncJobData;
    const { processed, batchWasFull } = await this.ingest.sync(
      accountId,
      mailbox,
    );
    this.logger.log(
      `Synced ${processed} message(s) for ${accountId}/${mailbox}${batchWasFull ? ' (continuing)' : ''}`,
    );
    if (batchWasFull) {
      await this.queue.add(
        SYNC_MAILBOX_JOB,
        { accountId, mailbox },
        SYNC_JOB_OPTS,
      );
    }
  }
}
