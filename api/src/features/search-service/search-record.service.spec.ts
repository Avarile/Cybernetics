import type { ConfigService } from '@nestjs/config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SearchEngineError } from '../../infrastructure/search-engine/search-engine.interface';
import type { CompiledCollection } from './index-registry';
import { SearchRecordService } from './search-record.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const compiled: CompiledCollection = {
  name: 'articles',
  displayName: 'Articles',
  description: null,
  fields: [
    { name: 'title', type: 'string', required: true, searchable: true },
    { name: 'status', type: 'string', filterable: true },
  ],
  definition: {
    name: 'articles',
    primaryKey: 'id',
    searchableAttributes: ['title'],
    filterableAttributes: ['status', 'createdAt', 'updatedAt', 'externalId'],
    sortableAttributes: ['createdAt', 'updatedAt'],
  },
};

const config = {
  getOrThrow: () => ({ defaultPageSize: 20, maxPageSize: 100 }),
} as unknown as ConfigService;

function make(
  repoOverrides: Record<string, any> = {},
  engineOverrides: Record<string, any> = {},
) {
  const engine = {
    search: jest.fn(async () => ({
      hits: [{ id: '1' }],
      totalHits: 1,
      page: 1,
      hitsPerPage: 20,
      totalPages: 1,
      processingTimeMs: 2,
    })),
    ...engineOverrides,
  };
  const records = {
    findLiveByExternalId: jest.fn(async () => null),
    findLiveById: jest.fn(async () => null),
    create: jest.fn(async (v: Record<string, unknown>) => ({
      id: 'rec-1',
      externalId: v.externalId ?? null,
      ...v,
    })),
    update: jest.fn(async (id: string, patch: Record<string, unknown>) => ({
      id,
      externalId: 'ext',
      ...patch,
    })),
    softDelete: jest.fn(async () => undefined),
    ...repoOverrides,
  };
  const queue = { add: jest.fn(async () => undefined) };
  const registry = {
    resolve: jest.fn(async (name: string) =>
      name === 'articles' ? compiled : null,
    ),
  };
  const service = new SearchRecordService(
    engine as never,
    records as never,
    registry as never,
    queue as never,
    config,
    new ExceptionService(),
  );
  return { service, engine, records, queue, registry };
}

function searchArg(engine: any) {
  return engine.search.mock.calls[0]?.[1];
}

describe('SearchRecordService.persist', () => {
  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(
      service.persist('nope', [{ document: { title: 'x' } }]),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
      message: 'Unknown collection "nope"',
    });
  });

  it('400s when a document fails validation', async () => {
    const { service } = make();
    await expect(
      service.persist('articles', [{ document: { title: 123 } }]),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Record 0 failed validation',
      details: {
        issues: [
          {
            path: 'records[0]',
            message: 'Field "title" must be of type string',
          },
        ],
      },
    });
  });

  it('creates a PENDING row and enqueues an index job', async () => {
    const { service, records, queue } = make();
    const results = await service.persist('articles', [
      { document: { title: 'Hello' } },
    ]);
    expect(records.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'articles',
        indexState: 'PENDING',
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'index-record',
      { id: 'rec-1' },
      expect.anything(),
    );
    expect(results[0].indexState).toBe('PENDING');
  });

  it('is a no-op when an unchanged, already-indexed record is re-sent', async () => {
    const { computeChecksum } = await import('./search.util');
    const checksum = computeChecksum('ext-1', { title: 'Hello' });
    const { service, queue } = make({
      findLiveByExternalId: jest.fn(async () => ({
        id: 'rec-1',
        externalId: 'ext-1',
        indexState: 'INDEXED',
        checksum,
      })),
      create: jest.fn(),
    });
    const results = await service.persist('articles', [
      { externalId: 'ext-1', document: { title: 'Hello' } },
    ]);
    expect(results[0].indexState).toBe('INDEXED');
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('SearchRecordService.search', () => {
  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(
      service.search('nope', { q: '', page: 1 }),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
      message: 'Unknown collection "nope"',
    });
  });

  it('builds an allowlisted filter clause', async () => {
    const { service, engine } = make();
    await service.search('articles', {
      q: '',
      page: 1,
      filters: { status: 'live' },
    });
    expect(searchArg(engine).filter).toEqual(['status = "live"']);
  });

  it('rejects a non-allowlisted filter field', async () => {
    const { service } = make();
    await expect(
      service.search('articles', { q: '', page: 1, filters: { secret: 'x' } }),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_QUERY_INVALID,
      message: 'Unknown filter field "secret"',
    });
  });

  it('caps limit at maxPageSize', async () => {
    const { service, engine } = make();
    await service.search('articles', { q: '', page: 1, limit: 9999 });
    expect(searchArg(engine).hitsPerPage).toBe(100);
  });

  it('maps an engine failure to 503', async () => {
    const { service } = make(
      {},
      {
        search: jest.fn(async () => {
          throw new SearchEngineError('down');
        }),
      },
    );
    await expect(
      service.search('articles', { q: '', page: 1 }),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });
});

describe('SearchRecordService.remove / reload', () => {
  it('reload 404s on unknown collection then enqueues on a known one', async () => {
    const { service, queue } = make();
    await expect(service.reload('nope')).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
      message: 'Unknown collection "nope"',
    });
    await service.reload('articles');
    expect(queue.add).toHaveBeenCalledWith(
      'reindex-collection',
      { collection: 'articles' },
      expect.anything(),
    );
  });

  it('remove soft-deletes the row and enqueues a delete job', async () => {
    const { service, records, queue } = make({
      findLiveByExternalId: jest.fn(async () => ({
        id: 'rec-9',
        collection: 'articles',
        externalId: 'ext-9',
      })),
    });
    await service.remove('articles', 'ext-9');
    expect(records.softDelete).toHaveBeenCalledWith('rec-9');
    expect(queue.add).toHaveBeenCalledWith(
      'delete-record',
      { collection: 'articles', id: 'rec-9' },
      expect.anything(),
    );
  });
});
