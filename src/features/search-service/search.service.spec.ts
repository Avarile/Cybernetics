import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SearchEngineError } from '../../infrastructure/search-engine/search-engine.interface';
import { IndexRegistry, type RegisteredIndex } from './index-registry';
import { SearchService } from './search.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const filesDef: RegisteredIndex = {
  name: 'files',
  primaryKey: 'id',
  searchableAttributes: ['filename'],
  filterableAttributes: ['ownerId', 'status'],
  sortableAttributes: ['createdAt'],
  allowedFilterFields: ['status'],
  allowedSortFields: ['createdAt'],
  ownerScope: { attribute: 'ownerId', allowPublic: true },
};

const config = {
  getOrThrow: () => ({ defaultPageSize: 20, maxPageSize: 100 }),
} as unknown as ConfigService;

function makeService(engineOverrides: Record<string, any> = {}) {
  const engine = {
    search: jest.fn(async () => ({
      hits: [{ id: '1' }],
      totalHits: 1,
      page: 1,
      hitsPerPage: 20,
      totalPages: 1,
      processingTimeMs: 2,
    })),
    ensureIndex: jest.fn(async () => undefined),
    ...engineOverrides,
  };
  const queue = { add: jest.fn(async () => undefined) };
  const registry = new IndexRegistry([filesDef]);
  const service = new SearchService(
    engine as any,
    registry,
    queue as any,
    config,
  );
  return { service, engine, queue };
}

describe('SearchService.search', () => {
  it('injects an owner filter for a user principal (allowPublic)', async () => {
    const { service, engine } = makeService();
    await service.search('files', { q: 'x', page: 1 }, { id: 'user-1' });
    expect(engine.search.mock.calls[0][1].filter).toEqual([
      '(ownerId = "user-1" OR ownerId IS NULL)',
    ]);
  });

  it('does NOT scope for the system principal', async () => {
    const { service, engine } = makeService();
    await service.search('files', { q: 'x', page: 1 }, { id: null });
    expect(engine.search.mock.calls[0][1].filter).toBeUndefined();
  });

  it('ANDs allowlisted user filters after the owner clause', async () => {
    const { service, engine } = makeService();
    await service.search(
      'files',
      { q: '', page: 1, filters: { status: 'AVAILABLE' } },
      { id: 'u' },
    );
    expect(engine.search.mock.calls[0][1].filter).toEqual([
      '(ownerId = "u" OR ownerId IS NULL)',
      'status = "AVAILABLE"',
    ]);
  });

  it('rejects a filter on the owner attribute', async () => {
    const { service } = makeService();
    await expect(
      service.search(
        'files',
        { q: '', page: 1, filters: { ownerId: 'other' } },
        { id: 'u' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-allowlisted filter field', async () => {
    const { service } = makeService();
    await expect(
      service.search(
        'files',
        { q: '', page: 1, filters: { secret: 'x' } },
        { id: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps limit at maxPageSize', async () => {
    const { service, engine } = makeService();
    await service.search(
      'files',
      { q: '', page: 1, limit: 9999 },
      { id: null },
    );
    expect(engine.search.mock.calls[0][1].hitsPerPage).toBe(100);
  });

  it('404s on an unknown index', async () => {
    const { service } = makeService();
    await expect(
      service.search('nope', { q: '', page: 1 }, { id: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps engine failure to 503', async () => {
    const { service } = makeService({
      search: jest.fn(async () => {
        throw new SearchEngineError('down');
      }),
    });
    await expect(
      service.search('files', { q: '', page: 1 }, { id: null }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('SearchService indexing', () => {
  it('enqueueIndex adds an index-docs job', async () => {
    const { service, queue } = makeService();
    await service.enqueueIndex('files', [{ id: '1' }]);
    expect(queue.add).toHaveBeenCalledWith(
      'index-docs',
      { index: 'files', docs: [{ id: '1' }] },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('enqueueDelete/reindex validate the index', async () => {
    const { service } = makeService();
    await expect(service.enqueueDelete('nope', ['1'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.reindex('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('onApplicationBootstrap ensures each registered index', async () => {
    const { service, engine } = makeService();
    await service.onApplicationBootstrap();
    expect(engine.ensureIndex).toHaveBeenCalledWith(filesDef);
  });
});
