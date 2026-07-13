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

/**
 * Second fixture with a numeric and an array-capable field, so the
 * numeric/array branches of `toFilterClause` and the sort/facet rejection
 * paths can be exercised without touching `filesDef`'s existing tests.
 */
const itemsDef: RegisteredIndex = {
  name: 'items',
  primaryKey: 'id',
  searchableAttributes: ['name'],
  filterableAttributes: ['ownerId', 'status', 'size', 'tags'],
  sortableAttributes: ['size'],
  allowedFilterFields: ['status', 'size', 'tags'],
  allowedSortFields: ['size'],
  ownerScope: { attribute: 'ownerId', allowPublic: true },
};

const config = {
  getOrThrow: () => ({ defaultPageSize: 20, maxPageSize: 100 }),
} as unknown as ConfigService;

/** Mirrors `search.service.ts`'s private `quote()` escaping rule exactly, so
 * expected filter strings are derived from the same rule under test rather
 * than hand-typed escape sequences. */
function expectedQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

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
  const registry = new IndexRegistry([filesDef, itemsDef]);
  const service = new SearchService(
    engine as any,
    registry,
    queue as any,
    config,
  );
  return { service, engine, queue };
}

/** Options object passed to the engine's Nth `search` call (test-only cast). */
function searchArg(engine: any, call = 0): any {
  return engine.search.mock.calls[call]?.[1];
}

describe('SearchService.search', () => {
  it('injects an owner filter for a user principal (allowPublic)', async () => {
    const { service, engine } = makeService();
    await service.search('files', { q: 'x', page: 1 }, { id: 'user-1' });
    expect(searchArg(engine).filter).toEqual([
      '(ownerId = "user-1" OR ownerId IS NULL)',
    ]);
  });

  it('does NOT scope for the system principal', async () => {
    const { service, engine } = makeService();
    await service.search('files', { q: 'x', page: 1 }, { id: null });
    expect(searchArg(engine).filter).toBeUndefined();
  });

  it('ANDs allowlisted user filters after the owner clause', async () => {
    const { service, engine } = makeService();
    await service.search(
      'files',
      { q: '', page: 1, filters: { status: 'AVAILABLE' } },
      { id: 'u' },
    );
    expect(searchArg(engine).filter).toEqual([
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
    expect(searchArg(engine).hitsPerPage).toBe(100);
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

  it('escapes a filter value so it cannot break out into a new clause (injection containment)', async () => {
    const { service, engine } = makeService();
    const malicious = 'a" OR ownerId = "x';
    // system principal (id: null): no owner-scope clause, so this is the
    // ONLY clause in the array — proving the malicious value stays fully
    // contained inside the `status = "..."` clause rather than escaping
    // into a second, attacker-controlled `OR ownerId = ...` clause.
    await service.search(
      'items',
      { q: '', page: 1, filters: { status: malicious } },
      { id: null },
    );
    expect(searchArg(engine).filter).toEqual([
      `status = ${expectedQuote(malicious)}`,
    ]);
  });

  it('quotes and escapes each element of an array filter value (IN clause)', async () => {
    const { service, engine } = makeService();
    await service.search(
      'items',
      { q: '', page: 1, filters: { tags: ['a', 'b"c'] } },
      { id: null },
    );
    expect(searchArg(engine).filter).toEqual([
      `tags IN [${expectedQuote('a')}, ${expectedQuote('b"c')}]`,
    ]);
  });

  it('leaves a numeric filter value unquoted', async () => {
    const { service, engine } = makeService();
    await service.search(
      'items',
      { q: '', page: 1, filters: { size: 10 } },
      { id: null },
    );
    expect(searchArg(engine).filter).toEqual(['size = 10']);
  });

  it('rejects a sort on a non-allowlisted field', async () => {
    const { service } = makeService();
    await expect(
      service.search(
        'items',
        { q: '', page: 1, sort: ['status:asc'] },
        { id: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a sort direction other than asc/desc', async () => {
    const { service } = makeService();
    await expect(
      service.search(
        'items',
        { q: '', page: 1, sort: ['size:sideways'] },
        { id: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a facet not in filterableAttributes', async () => {
    const { service } = makeService();
    await expect(
      service.search(
        'items',
        { q: '', page: 1, facets: ['secretFacet'] },
        { id: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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
