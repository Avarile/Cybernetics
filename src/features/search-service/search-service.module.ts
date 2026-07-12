import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_SEARCH_INDEXES, IndexRegistry } from './index-registry';
import { SearchIndexingProcessor } from './processors/search-indexing.processor';
import {
  SEARCH_INDEXING_QUEUE,
  SEARCH_INDEX_DEFINITIONS,
} from './search.constants';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Search-service feature. Exposes the external REST API (SearchController) and
 * the internal SearchService (exported for agents / pipeline modules). Registers
 * the `search-indexing` BullMQ queue.
 *
 * Depends on the global SearchEngineModule (SEARCH_ENGINE) and QueueModule.
 */
@Module({
  imports: [BullModule.registerQueue({ name: SEARCH_INDEXING_QUEUE })],
  controllers: [SearchController],
  providers: [
    { provide: SEARCH_INDEX_DEFINITIONS, useValue: APP_SEARCH_INDEXES },
    IndexRegistry,
    SearchService,
    SearchIndexingProcessor,
  ],
  exports: [SearchService],
})
export class SearchServiceModule {}
