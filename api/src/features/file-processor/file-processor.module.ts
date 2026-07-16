import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FILE_PROCESSING_QUEUE } from './file.constants';
import { FileController } from './file.controller';
import { FileRepository } from './file.repository';
import { FileService } from './file.service';
import { FileProcessingProcessor } from './processors/file-processing.processor';
import { FileReconciliationScheduler } from './schedulers/file-reconciliation.scheduler';

/**
 * File-processor feature. Exposes the external REST API (FileController) and the
 * internal FileService (for agents / pipeline modules — exported). Registers the
 * `file-processing` BullMQ queue consumed by FileProcessingProcessor.
 *
 * Depends on the global DatabaseModule (DRIZZLE), FileManageModule
 * (OBJECT_STORAGE), and QueueModule (BullMQ connection).
 */
@Module({
  imports: [BullModule.registerQueue({ name: FILE_PROCESSING_QUEUE })],
  controllers: [FileController],
  providers: [
    FileService,
    FileRepository,
    FileProcessingProcessor,
    FileReconciliationScheduler,
  ],
  exports: [FileService],
})
export class FileProcessorModule {}
