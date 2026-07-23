// See search-query.tool.spec.ts for why `@mastra/core/tools` is stubbed here.
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));

import { searchDocumentsExecute } from './search-documents.tool';
import { DOCUMENTS_COLLECTION } from '../../document-ingest/document-ingest.constants';

describe('searchDocumentsExecute', () => {
  it('scopes the search to the caller and the documents collection', async () => {
    const search = jest.fn().mockResolvedValue({
      totalHits: 1,
      hits: [{ title: 'a' }],
      facetDistribution: undefined,
    });
    const res = await searchDocumentsExecute(
      { query: 'invoice', topK: 5 },
      { searchRecords: { search } },
      { principal: { id: 'user-1' }, conversationId: 'c1', runId: 'r1' },
    );
    const [collection, req] = search.mock.calls[0];
    expect(collection).toBe(DOCUMENTS_COLLECTION);
    expect(req.filters).toEqual({ ownerUserId: 'user-1' });
    expect(req.q).toBe('invoice');
    expect(res.totalHits).toBe(1);
  });

  it('returns an empty result when there is no principal id', async () => {
    const search = jest.fn();
    const res = await searchDocumentsExecute(
      { query: '', topK: 5 },
      { searchRecords: { search } },
      { principal: { id: null }, conversationId: null, runId: null },
    );
    expect(search).not.toHaveBeenCalled();
    expect(res.totalHits).toBe(0);
    expect(res.hits).toEqual([]);
  });
});
