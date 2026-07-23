import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import type { StorageConfig } from '../../../config/configurations/storage.config';
import {
  INGEST_DOCUMENT_JOB,
  INGEST_DOCUMENT_QUEUE,
  isIngestableDocMime,
} from '../../document-ingest/document-ingest.constants';
import { OBJECT_STORAGE } from '../../../infrastructure/file-manage/minio.constants';
import type { ObjectStorage } from '../../../infrastructure/file-manage/object-storage.interface';
import {
  FILE_PROCESS_JOB,
  FILE_PROCESSING_QUEUE,
  FILE_RECONCILE_JOB,
} from '../file.constants';
import { FileRepository } from '../file.repository';
import { isDeclaredMimeMismatch } from '../file.util';

/**
 * Consumes the `file-processing` queue:
 *  - process-file:    verify/backfill SHA-256 + magic-byte check → AVAILABLE or QUARANTINED;
 *                      enqueues `document-ingest` for ingestable MIME types that pass integrity.
 *  - reconcile-files: expire stale PENDING rows; purge unreferenced objects.
 */
@Processor(FILE_PROCESSING_QUEUE)
export class FileProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(FileProcessingProcessor.name);
  private readonly pendingTtlMs: number;

  constructor(
    private readonly repo: FileRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    config: ConfigService,
    @InjectQueue(INGEST_DOCUMENT_QUEUE) private readonly ingestQueue: Queue,
  ) {
    super();
    this.pendingTtlMs =
      config.getOrThrow<StorageConfig>('storage').pendingTtlSeconds * 1000;
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case FILE_PROCESS_JOB: {
        const { fileId } = job.data as { fileId: string };
        await this.processFile(fileId);
        break;
      }
      case FILE_RECONCILE_JOB:
        await this.reconcile();
        break;
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }

  private async processFile(fileId: string): Promise<void> {
    const row = await this.repo.findById(fileId);
    if (!row || row.status !== 'AVAILABLE') return;

    // Single streaming pass: compute SHA-256 and capture the header bytes.
    const stream = await this.storage.getObjectStream(row.objectKey);
    const hash = createHash('sha256');
    let head: Buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      if (head.length < 16) {
        head = Buffer.concat([head, buf.subarray(0, 16 - head.length)]);
      }
      hash.update(buf);
    }
    const digest = hash.digest('hex');

    // Integrity: a declared checksum that doesn't match is a hard failure.
    if (row.checksumSha256 && row.checksumSha256 !== digest) {
      await this.repo.markStatus(fileId, 'QUARANTINED', {
        metadata: { ...row.metadata, quarantineReason: 'checksum-mismatch' },
      });
      this.logger.warn(`File ${fileId} quarantined: checksum mismatch`);
      return;
    }

    // Content sniffing: declared MIME must not contradict the magic bytes.
    if (isDeclaredMimeMismatch(row.mimeType, head)) {
      await this.repo.markStatus(fileId, 'QUARANTINED', {
        checksumSha256: row.checksumSha256 ?? digest,
        metadata: { ...row.metadata, quarantineReason: 'mime-mismatch' },
      });
      this.logger.warn(`File ${fileId} quarantined: MIME mismatch`);
      return;
    }

    // Backfill the checksum when it wasn't declared.
    if (!row.checksumSha256) {
      await this.repo.markStatus(fileId, 'AVAILABLE', {
        checksumSha256: digest,
      });
    }

    // Integrity passed — hand ingestable document types to the ingest pipeline.
    if (isIngestableDocMime(row.mimeType)) {
      await this.ingestQueue.add(
        INGEST_DOCUMENT_JOB,
        { fileId, ownerId: row.ownerId },
        {
          removeOnComplete: true,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
    }
  }

  private async reconcile(): Promise<void> {
    const cutoff = new Date(Date.now() - this.pendingTtlMs);
    const stale = await this.repo.findStalePending(cutoff);
    for (const row of stale) {
      await this.repo.softDelete(row.id);
    }

    const purgeable = await this.repo.findPurgeable();
    for (const row of purgeable) {
      if ((await this.repo.countLiveReferences(row.objectKey)) === 0) {
        try {
          await this.storage.removeObject(row.objectKey);
        } catch (error) {
          this.logger.warn(
            `Failed to remove object ${row.objectKey}: ${(error as Error).message}`,
          );
        }
      }
      await this.repo.hardDelete(row.id);
    }

    this.logger.log(
      `Reconciliation: expired ${stale.length} pending, purged ${purgeable.length} terminal rows`,
    );
  }
}
