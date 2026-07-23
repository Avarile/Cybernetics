import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { FileService } from '../file-processor/file.service';
import { SearchRecordService } from '../search-service/search-record.service';
import { DocumentExtractionService } from './document-extraction.service';
import {
  DOCUMENTS_COLLECTION,
  INGEST_DOCUMENT_JOB,
  INGEST_DOCUMENT_QUEUE,
} from './document-ingest.constants';

@Processor(INGEST_DOCUMENT_QUEUE)
export class DocumentIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentIngestProcessor.name);

  constructor(
    private readonly files: FileService,
    private readonly extraction: DocumentExtractionService,
    private readonly records: SearchRecordService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== INGEST_DOCUMENT_JOB) return;
    const { fileId } = job.data as { fileId: string };
    // Read/extract as the file owner so ownership checks pass; fall back to system.
    const meta = await this.files.getMetadata(fileId, SYSTEM_PRINCIPAL);
    const owner = { id: meta.ownerId ?? null, role: 'agent' as const };
    const stream = await this.files.getContentStream(fileId, owner);
    const { text, title } = await this.extraction.extract(
      meta.mimeType,
      stream,
    );
    const conversationId =
      typeof meta.metadata?.conversationId === 'string'
        ? meta.metadata.conversationId
        : undefined;

    await this.records.persist(DOCUMENTS_COLLECTION, [
      {
        externalId: fileId, // idempotent upsert per file
        document: {
          title: title ?? meta.filename,
          text,
          fileId,
          mimeType: meta.mimeType,
          ownerUserId: meta.ownerId ?? '',
          ...(conversationId ? { conversationId } : {}),
        },
      },
    ]);
    this.logger.log(`Ingested file ${fileId} into "${DOCUMENTS_COLLECTION}"`);
  }
}
