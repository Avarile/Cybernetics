import type { ConfigService } from '@nestjs/config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { FileService } from './file.service';

// Test doubles are intentionally loosely typed.
/* eslint-disable @typescript-eslint/no-unsafe-argument */

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    ownerId: null,
    bucket: 'cybernetics',
    objectKey: 'uploads/abc',
    originalFilename: 'file.bin',
    mimeType: 'application/octet-stream',
    size: 10,
    checksumSha256: null,
    status: 'PENDING',
    metadata: {},
    isDeleted: false,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

describe('FileService', () => {
  let storage: any;
  let repo: any;
  let queue: any;
  let service: FileService;

  const config = {
    getOrThrow: () => ({
      maxFileSize: 100,
      allowedMimeTypes: [] as string[],
      presignExpirySeconds: 300,
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    storage = {
      bucketName: jest.fn(() => 'cybernetics'),
      presignedPostPolicy: jest.fn(async () => ({
        url: 'http://minio/post',
        fields: {},
        expiresIn: 300,
      })),
      presignedGetUrl: jest.fn(async () => ({
        url: 'http://minio/get',
        expiresIn: 300,
      })),
      objectExists: jest.fn(async () => true),
      statObject: jest.fn(async () => ({
        size: 10,
        etag: 'e',
        lastModified: new Date(),
      })),
      removeObject: jest.fn(async () => undefined),
      putObject: jest.fn(async () => ({ etag: 'e' })),
      getObjectStream: jest.fn(),
    };
    repo = {
      create: jest.fn(async (v: any) => makeRow(v)),
      findById: jest.fn(),
      findAvailableByChecksum: jest.fn(async () => null),
      findByOwner: jest.fn(async () => ({ rows: [], total: 0 })),
      markStatus: jest.fn(async (id: string, status: string, patch: any) =>
        makeRow({ id, status, ...patch }),
      ),
      softDelete: jest.fn(async () => undefined),
      countLiveReferences: jest.fn(async () => 0),
    };
    queue = { add: jest.fn(async () => undefined) };
    service = new FileService(
      storage,
      repo,
      queue,
      config,
      new ExceptionService(),
    );
  });

  describe('initiateUpload', () => {
    it('creates a PENDING row and returns a presigned upload target', async () => {
      const res = await service.initiateUpload(
        { filename: 'a.bin', mimeType: 'application/octet-stream', size: 10 },
        { id: null },
      );
      expect(res.deduplicated).toBe(false);
      expect(res.upload?.url).toBe('http://minio/post');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING' }),
      );
    });

    it('deduplicates when the checksum already exists', async () => {
      const sha = 'a'.repeat(64);
      repo.findAvailableByChecksum.mockResolvedValueOnce(
        makeRow({
          status: 'AVAILABLE',
          objectKey: 'sha256/aa/aa/x',
          checksumSha256: sha,
          size: 5,
        }),
      );
      const res = await service.initiateUpload(
        {
          filename: 'a.bin',
          mimeType: 'application/octet-stream',
          size: 5,
          sha256: sha,
        },
        { id: null },
      );
      expect(res.deduplicated).toBe(true);
      expect(res.upload).toBeUndefined();
      expect(storage.presignedPostPolicy).not.toHaveBeenCalled();
    });

    it('rejects an oversized file', async () => {
      await expect(
        service.initiateUpload(
          { filename: 'a', mimeType: 'text/plain', size: 1000 },
          { id: null },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_TOO_LARGE });
    });

    it('rejects a disallowed MIME type', async () => {
      const cfg = {
        getOrThrow: () => ({
          maxFileSize: 100,
          allowedMimeTypes: ['image/png'],
          presignExpirySeconds: 300,
        }),
      } as unknown as ConfigService;
      const restricted = new FileService(
        storage,
        repo,
        queue,
        cfg,
        new ExceptionService(),
      );
      await expect(
        restricted.initiateUpload(
          { filename: 'a', mimeType: 'text/plain', size: 10 },
          { id: null },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_MIME_NOT_ALLOWED });
    });
  });

  describe('completeUpload', () => {
    it('transitions PENDING → AVAILABLE and enqueues processing', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ status: 'PENDING' }));
      const res = await service.completeUpload('id', { id: null });
      expect(repo.markStatus).toHaveBeenCalledWith(
        'id',
        'AVAILABLE',
        expect.any(Object),
      );
      expect(queue.add).toHaveBeenCalled();
      expect(res.status).toBe('AVAILABLE');
    });

    it('rejects when the file is not PENDING', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ status: 'AVAILABLE' }));
      await expect(
        service.completeUpload('id', { id: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.FILE_INVALID_STATE,
        message: 'File is not awaiting upload (status=AVAILABLE)',
      });
    });

    it('rejects when the object is missing from storage', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ status: 'PENDING' }));
      storage.objectExists.mockResolvedValueOnce(false);
      await expect(
        service.completeUpload('id', { id: null }),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_UPLOAD_MISSING });
    });
  });

  describe('ownership', () => {
    it('hides files owned by another principal', async () => {
      repo.findById.mockResolvedValueOnce(
        makeRow({ ownerId: 'someone-else', status: 'AVAILABLE' }),
      );
      await expect(
        service.getMetadata('id', { id: 'me' }),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_NOT_FOUND });
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a presigned GET url for an available file', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ status: 'AVAILABLE' }));
      const res = await service.getDownloadUrl('id', { id: null });
      expect(res.url).toBe('http://minio/get');
    });

    it('rejects when the file is not available', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ status: 'PENDING' }));
      await expect(
        service.getDownloadUrl('id', { id: null }),
      ).rejects.toMatchObject({
        code: ErrorCode.FILE_INVALID_STATE,
        message: 'File is not available (status=PENDING)',
      });
    });
  });

  describe('softDelete', () => {
    it('soft-deletes an owned file', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ status: 'AVAILABLE' }));
      await service.softDelete('id', { id: null });
      expect(repo.softDelete).toHaveBeenCalledWith('id');
    });
  });

  describe('putFromStream allowAnyMime', () => {
    // The outer `config` allows every MIME type (empty allowlist), so these
    // cases need a restricted allowlist to exercise the bypass meaningfully.
    const restrictedConfig = {
      getOrThrow: () => ({
        maxFileSize: 100,
        allowedMimeTypes: ['application/pdf'],
        presignExpirySeconds: 300,
      }),
    } as unknown as ConfigService;

    it('rejects a disallowed MIME by default', async () => {
      const restricted = new FileService(
        storage,
        repo,
        queue,
        restrictedConfig,
        new ExceptionService(),
      );
      await expect(
        restricted.putFromStream(
          Buffer.from('x'),
          { filename: 'a.bin', mimeType: 'application/zip', size: 4 },
          { id: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FILE_MIME_NOT_ALLOWED,
        message: expect.stringMatching(/not allowed/),
      });
    });

    it('accepts a disallowed MIME when allowAnyMime is set', async () => {
      const restricted = new FileService(
        storage,
        repo,
        queue,
        restrictedConfig,
        new ExceptionService(),
      );
      const res = await restricted.putFromStream(
        Buffer.from('x'),
        {
          filename: 'a.bin',
          mimeType: 'application/zip',
          size: 4,
          allowAnyMime: true,
        },
        { id: null },
      );
      expect(res.id).toBeDefined();
      expect(repo.create).toHaveBeenCalled();
    });

    it('still enforces maxFileSize even with allowAnyMime', async () => {
      const restricted = new FileService(
        storage,
        repo,
        queue,
        restrictedConfig,
        new ExceptionService(),
      );
      await expect(
        restricted.putFromStream(
          Buffer.from('x'),
          {
            filename: 'a.bin',
            mimeType: 'application/zip',
            size: 9999,
            allowAnyMime: true,
          },
          { id: null },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FILE_TOO_LARGE,
        message: expect.stringMatching(/exceeds the maximum/),
      });
    });
  });
});
