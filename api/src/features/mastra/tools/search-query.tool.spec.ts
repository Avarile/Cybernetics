// `@mastra/core/tools`'s cjs build eagerly requires `@sindresorhus/slugify`, which is
// ESM-only (`"type": "module"`) and breaks under Jest's default transformIgnorePatterns.
// The pure `searchQueryExecute` under test never touches `createTool`, so stub it out
// rather than loading the real (currently Jest-incompatible) module.
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));

import { searchQueryExecute } from './search-query.tool';

const engineResult = {
  hits: [{ id: '1', title: 'A' }],
  totalHits: 1,
  page: 1,
  hitsPerPage: 10,
  totalPages: 1,
  processingTimeMs: 1,
  facetDistribution: { status: { live: 1 } },
};

function deps() {
  return {
    searchRecords: { search: jest.fn(async () => engineResult) },
  } as never;
}

describe('searchQueryExecute', () => {
  it('caps topK at 25 and returns a curated result', async () => {
    const d = deps();
    const out = await searchQueryExecute(
      { collection: 'articles', query: 'a', topK: 999 },
      d,
    );
    expect((d as any).searchRecords.search).toHaveBeenCalledWith(
      'articles',
      expect.objectContaining({ q: 'a', limit: 25 }),
    );
    expect(out.totalHits).toBe(1);
    expect(out.hits).toHaveLength(1);
    expect(out.facets).toEqual({ status: { live: 1 } });
  });

  it('passes allowlisted filters through', async () => {
    const d = deps();
    await searchQueryExecute(
      {
        collection: 'articles',
        query: '',
        filters: { status: 'live' },
        topK: 5,
      },
      d,
    );
    expect((d as any).searchRecords.search).toHaveBeenCalledWith(
      'articles',
      expect.objectContaining({ filters: { status: 'live' }, limit: 5 }),
    );
  });

  it('rejects the private "documents" collection and never calls search', async () => {
    const d = deps();
    await expect(
      searchQueryExecute({ collection: 'documents', query: '', topK: 10 }, d),
    ).rejects.toThrow();
    expect((d as any).searchRecords.search).not.toHaveBeenCalled();
  });
});
