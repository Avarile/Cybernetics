import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { StorageConfig } from '../../config/configurations/storage.config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { OBJECT_STORAGE } from '../../infrastructure/file-manage/minio.constants';
import type {
  ObjectStorage,
  PresignedTarget,
} from '../../infrastructure/file-manage/object-storage.interface';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { QueryFilesDto } from './dto/query-files.dto';
import { FILE_PROCESS_JOB, FILE_PROCESSING_QUEUE } from './file.constants';
import { FileRepository } from './file.repository';
import {
  toFileMetadata,
  type FileMetadata,
  type FilePrincipal,
} from './file.types';
import {
  contentAddressedKey,
  isMimeAllowed,
  randomObjectKey,
} from './file.util';

/** Result of initiating an upload. `upload` is absent when content was deduped. */
export interface InitiateResult {
  fileId: string;
  deduplicated: boolean;
  upload?: PresignedTarget;
}

/** Metadata for a direct in-process upload (agents / pipeline). */
export interface DirectPutMeta {
  filename: string;
  mimeType: string;
  size?: number;
  sha256?: string;
  metadata?: Record<string, unknown>;
  /** Trusted internal callers only: skips the MIME-allowlist check (size limit still applies). */
  allowAnyMime?: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * File-processor service. The controller uses the lifecycle methods for the
 * external presigned flow; in-process callers (agents / pipeline) additionally
 * use `putFromStream` / `getContentStream`, which talk to storage directly
 * (no HTTP round-trip). Every read/mutate enforces ownership.
 */
@Injectable()
export class FileService {
  private readonly maxFileSize: number;
  private readonly allowedMimeTypes: readonly string[];
  private readonly presignExpiry: number;

  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly repo: FileRepository,
    @InjectQueue(FILE_PROCESSING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
    private readonly errors: ExceptionService,
  ) {
    const storageConfig = config.getOrThrow<StorageConfig>('storage');
    this.maxFileSize = storageConfig.maxFileSize;
    this.allowedMimeTypes = storageConfig.allowedMimeTypes;
    this.presignExpiry = storageConfig.presignExpirySeconds;
  }

  // ── Lifecycle (shared with the controller) ──────────────────────────────

  /**
   * Step 1 of the presigned upload. Validates declared metadata, deduplicates by
   * checksum, and returns a presigned POST target (also used when handing an
   * upload URL to an out-of-process tool).
   */
  async initiateUpload(
    input: InitiateUploadDto,
    owner: FilePrincipal,
  ): Promise<InitiateResult> {
    this.assertPolicy(input.mimeType, input.size);

    if (input.sha256) {
      const deduped = await this.tryDedup(input.sha256, owner, {
        filename: input.filename,
        mimeType: input.mimeType,
        metadata: input.metadata,
      });
      if (deduped) return { fileId: deduped.id, deduplicated: true };
    }

    const objectKey = input.sha256
      ? contentAddressedKey(input.sha256)
      : randomObjectKey();

    const row = await this.repo.create({
      ownerId: owner.id,
      bucket: this.storage.bucketName(),
      objectKey,
      originalFilename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      checksumSha256: input.sha256?.toLowerCase() ?? null,
      status: 'PENDING',
      metadata: input.metadata ?? {},
    });

    const upload = await this.storage.presignedPostPolicy(objectKey, {
      expiresIn: this.presignExpiry,
      maxSize: this.maxFileSize,
      contentType: input.mimeType,
    });

    return { fileId: row.id, deduplicated: false, upload };
  }

  /**
   * Step 2 of the presigned upload. Verifies the object landed and is within
   * policy, transitions PENDING → AVAILABLE, and enqueues async processing.
   */
  async completeUpload(
    fileId: string,
    owner: FilePrincipal,
    dto?: { sha256?: string },
  ): Promise<FileMetadata> {
    const row = await this.loadOwned(fileId, owner);
    if (row.status !== 'PENDING') {
      throw this.errors.create(ErrorCode.FILE_INVALID_STATE, {
        message: `File is not awaiting upload (status=${row.status})`,
      });
    }

    if (!(await this.storage.objectExists(row.objectKey))) {
      throw this.errors.create(ErrorCode.FILE_UPLOAD_MISSING);
    }

    const stat = await this.storage.statObject(row.objectKey);
    if (stat.size > this.maxFileSize) {
      // Defence-in-depth: the POST policy should already have blocked this.
      await this.repo.softDelete(fileId);
      if ((await this.repo.countLiveReferences(row.objectKey)) === 0) {
        await this.storage.removeObject(row.objectKey);
      }
      throw this.errors.create(ErrorCode.FILE_TOO_LARGE, {
        message: `Uploaded file size ${stat.size} exceeds the maximum of ${this.maxFileSize} bytes`,
      });
    }

    const updated = await this.repo.markStatus(fileId, 'AVAILABLE', {
      size: stat.size,
      checksumSha256: dto?.sha256?.toLowerCase() ?? row.checksumSha256,
    });
    if (!updated) throw this.errors.create(ErrorCode.FILE_NOT_FOUND);

    await this.enqueueProcessing(fileId);
    return toFileMetadata(updated);
  }

  async getMetadata(
    fileId: string,
    owner: FilePrincipal,
  ): Promise<FileMetadata> {
    const row = await this.loadOwned(fileId, owner);
    return toFileMetadata(row);
  }

  async list(
    query: QueryFilesDto,
    owner: FilePrincipal,
  ): Promise<Paginated<FileMetadata>> {
    const { rows, total } = await this.repo.findByOwner(
      owner.id,
      query.page,
      query.limit,
      { status: query.status, mimeType: query.mimeType },
    );
    return {
      items: rows.map(toFileMetadata),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async softDelete(fileId: string, owner: FilePrincipal): Promise<void> {
    await this.loadOwned(fileId, owner);
    await this.repo.softDelete(fileId);
  }

  /** Short-lived presigned GET URL (for users and out-of-process tools). */
  async getDownloadUrl(
    fileId: string,
    owner: FilePrincipal,
    opts?: { ttl?: number },
  ): Promise<PresignedTarget> {
    const row = await this.loadOwned(fileId, owner);
    if (row.status !== 'AVAILABLE') {
      throw this.errors.create(ErrorCode.FILE_INVALID_STATE, {
        message: `File is not available (status=${row.status})`,
      });
    }
    return this.storage.presignedGetUrl(row.objectKey, {
      expiresIn: opts?.ttl ?? this.presignExpiry,
      downloadFilename: row.originalFilename,
    });
  }

  // ── Direct server-side transfer (in-process agents / pipeline) ──────────

  /**
   * Uploads bytes straight to storage from an in-process caller and records an
   * AVAILABLE row — collapsing the three-step external flow into one call.
   */
  async putFromStream(
    body: Readable | Buffer,
    meta: DirectPutMeta,
    owner: FilePrincipal,
  ): Promise<FileMetadata> {
    this.assertPolicy(meta.mimeType, meta.size, meta.allowAnyMime);

    let checksum = meta.sha256?.toLowerCase();
    if (!checksum && Buffer.isBuffer(body)) {
      checksum = createHash('sha256').update(body).digest('hex');
    }

    if (checksum) {
      const deduped = await this.tryDedup(checksum, owner, meta);
      if (deduped) return toFileMetadata(deduped);
    }

    const objectKey = checksum
      ? contentAddressedKey(checksum)
      : randomObjectKey();
    await this.storage.putObject(objectKey, body, {
      size: meta.size,
      contentType: meta.mimeType,
    });

    const size = meta.size ?? (await this.storage.statObject(objectKey)).size;

    const row = await this.repo.create({
      ownerId: owner.id,
      bucket: this.storage.bucketName(),
      objectKey,
      originalFilename: meta.filename,
      mimeType: meta.mimeType,
      size,
      checksumSha256: checksum ?? null,
      status: 'AVAILABLE',
      metadata: meta.metadata ?? {},
    });

    await this.enqueueProcessing(row.id);
    return toFileMetadata(row);
  }

  /** Streams an available file's bytes to an in-process consumer. */
  async getContentStream(
    fileId: string,
    owner: FilePrincipal,
  ): Promise<Readable> {
    const row = await this.loadOwned(fileId, owner);
    if (row.status !== 'AVAILABLE') {
      throw this.errors.create(ErrorCode.FILE_INVALID_STATE, {
        message: `File is not available (status=${row.status})`,
      });
    }
    return this.storage.getObjectStream(row.objectKey);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private assertPolicy(
    mimeType: string,
    size?: number,
    allowAnyMime = false,
  ): void {
    if (!allowAnyMime && !isMimeAllowed(mimeType, this.allowedMimeTypes)) {
      throw this.errors.create(ErrorCode.FILE_MIME_NOT_ALLOWED, {
        message: `MIME type "${mimeType}" is not allowed`,
      });
    }
    if (size !== undefined && size > this.maxFileSize) {
      throw this.errors.create(ErrorCode.FILE_TOO_LARGE, {
        message: `File size ${size} exceeds the maximum of ${this.maxFileSize} bytes`,
      });
    }
  }

  /** Loads a row and asserts the principal owns it (404 otherwise). */
  private async loadOwned(fileId: string, owner: FilePrincipal) {
    const row = await this.repo.findById(fileId);
    if (!row || row.isDeleted || row.ownerId !== owner.id) {
      throw this.errors.create(ErrorCode.FILE_NOT_FOUND);
    }
    return row;
  }

  /** Creates a metadata row referencing existing content, if any matches. */
  private async tryDedup(
    sha256: string,
    owner: FilePrincipal,
    meta: {
      filename: string;
      mimeType: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const existing = await this.repo.findAvailableByChecksum(
      sha256.toLowerCase(),
    );
    if (!existing) return null;
    return this.repo.create({
      ownerId: owner.id,
      bucket: existing.bucket,
      objectKey: existing.objectKey,
      originalFilename: meta.filename,
      mimeType: meta.mimeType,
      size: existing.size,
      checksumSha256: existing.checksumSha256,
      status: 'AVAILABLE',
      metadata: meta.metadata ?? {},
    });
  }

  private async enqueueProcessing(fileId: string): Promise<void> {
    await this.queue.add(
      FILE_PROCESS_JOB,
      { fileId },
      {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
  }
}
