import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { MailboxConfig } from '../../../config/configurations/mailbox.config';
import {
  MAILBOX_SYNC_QUEUE,
  RECONCILE_EVERY_MS,
  RECONCILE_MAILBOX_JOB,
} from '../mailbox.constants';

/**
 * Registers the repeatable reconciliation sweep on startup (best-effort so
 * boot never hard-requires Redis; mirrors MailboxSyncScheduler). Runs on the
 * same queue as sync, via a distinct job name handled by the existing
 * MailboxSyncProcessor. Uses `queue.upsertJobScheduler` keyed by a stable
 * scheduler id, which is idempotent — re-registering on every boot updates
 * the existing scheduler in place instead of orphaning a stale repeatable in
 * Redis.
 */
@Injectable()
export class MailboxReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailboxReconciliationScheduler.name);
  private readonly cfg: MailboxConfig;

  constructor(
    @InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.defaultAccountId) {
      this.logger.log(
        'Mailbox reconciliation disabled (MAILBOX_DEFAULT_ACCOUNT_ID unset)',
      );
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        `mailbox-reconcile:${this.cfg.defaultAccountId}:${this.cfg.mailbox}`,
        { every: RECONCILE_EVERY_MS },
        {
          name: RECONCILE_MAILBOX_JOB,
          data: {
            accountId: this.cfg.defaultAccountId,
            mailbox: this.cfg.mailbox,
          },
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log('Registered mailbox reconciliation sweep');
    } catch (err) {
      this.logger.warn(
        `Mailbox reconciliation registration skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
