import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailModule } from '../../infrastructure/email/email.module';
import { FileProcessorModule } from '../file-processor/file-processor.module';
import { SearchServiceModule } from '../search-service/search-service.module';
import { MailboxController } from './mailbox.controller';
import { MailboxIngestService } from './mailbox-ingest.service';
import { MailboxRepository } from './mailbox.repository';
import { MailboxService } from './mailbox.service';
import { MAILBOX_SYNC_QUEUE } from './mailbox.constants';
import { MailboxSyncProcessor } from './processors/mailbox-sync.processor';
import { MailboxReconciliationScheduler } from './schedulers/mailbox-reconciliation.scheduler';
import { MailboxSyncScheduler } from './schedulers/mailbox-sync.scheduler';

/**
 * Mailbox feature: durable inbound-email persistence. Composes EmailModule
 * (IMAP reads), FileProcessorModule (attachment/raw bytes → MinIO), and
 * SearchServiceModule (Meili indexing). Registers the `mailbox-sync` queue,
 * consumed by both the sync poll (MailboxSyncScheduler) and the
 * reconciliation sweep (MailboxReconciliationScheduler).
 */
@Module({
  imports: [
    EmailModule,
    FileProcessorModule,
    SearchServiceModule,
    BullModule.registerQueue({ name: MAILBOX_SYNC_QUEUE }),
  ],
  controllers: [MailboxController],
  providers: [
    MailboxRepository,
    MailboxIngestService,
    MailboxService,
    MailboxSyncProcessor,
    MailboxSyncScheduler,
    MailboxReconciliationScheduler,
  ],
  exports: [MailboxIngestService],
})
export class MailboxModule {}
