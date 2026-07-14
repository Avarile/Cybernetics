import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';
import { IndexRegistry } from './index-registry';
import { SearchIndexingProcessor } from './processors/search-indexing.processor';
import { RecordController } from './record.controller';
import { SearchReconciliationScheduler } from './schedulers/search-reconciliation.scheduler';
import { SearchQueryController } from './search.controller';
import { SEARCH_INDEXING_QUEUE } from './search.constants';
import { SearchRecordRepository } from './search-record.repository';
import { SearchRecordService } from './search-record.service';

/**
 * Search-service feature: a generic data processor. Admins manage collections
 * and persist records (Postgres = source of truth); everyone queries Meili.
 * Registers the `search-indexing` BullMQ queue. Depends on the global
 * SearchEngineModule (SEARCH_ENGINE), DatabaseModule (DRIZZLE), and QueueModule.
 */
@Module({
  imports: [BullModule.registerQueue({ name: SEARCH_INDEXING_QUEUE })],
  controllers: [CollectionController, RecordController, SearchQueryController],
  providers: [
    IndexRegistry,
    CollectionRepository,
    SearchRecordRepository,
    CollectionService,
    SearchRecordService,
    SearchIndexingProcessor,
    SearchReconciliationScheduler,
  ],
  exports: [SearchRecordService, CollectionService],
})
export class SearchServiceModule {}
