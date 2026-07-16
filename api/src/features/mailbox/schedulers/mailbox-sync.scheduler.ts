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
  SYNC_JOB_OPTS,
  SYNC_MAILBOX_JOB,
} from '../mailbox.constants';

/**
 * Registers the repeatable inbound-sync poll on startup (best-effort so boot
 * never hard-requires Redis; mirrors AgentScheduleScheduler). A fixed jobId means
 * overlapping polls coalesce. Also exposes `enqueueSync` for the manual endpoint.
 */
@Injectable()
export class MailboxSyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailboxSyncScheduler.name);
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
        'Mailbox poll disabled (MAILBOX_DEFAULT_ACCOUNT_ID unset)',
      );
      return;
    }
    try {
      await this.queue.add(
        SYNC_MAILBOX_JOB,
        { accountId: this.cfg.defaultAccountId, mailbox: this.cfg.mailbox },
        {
          repeat: { every: this.cfg.pollIntervalMs },
          jobId: `mailbox-poll:${this.cfg.defaultAccountId}:${this.cfg.mailbox}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Registered mailbox sync poll');
    } catch (err) {
      this.logger.warn(
        `Mailbox poll registration skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async enqueueSync(accountId: string, mailbox: string): Promise<void> {
    await this.queue.add(
      SYNC_MAILBOX_JOB,
      { accountId, mailbox },
      SYNC_JOB_OPTS,
    );
  }
}
