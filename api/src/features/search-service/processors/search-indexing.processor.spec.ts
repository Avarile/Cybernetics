import type { Job } from 'bullmq';
import type { SearchRecordRow } from '../../../infrastructure/database/schema/search.schema';
import { SearchIndexingProcessor } from './search-indexing.processor';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

function liveRow(over: Partial<SearchRecordRow> = {}): SearchRecordRow {
  return {
    id: 'rec-1',
    collection: 'articles',
    externalId: 'ext-1',
    document: { title: 'Hi' },
    checksum: 'c',
    indexState: 'PENDING',
    indexError: null,
    indexedAt: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as SearchRecordRow;
}

function make(repoOverrides: Record<string, any> = {}) {
  const engine = {
    addOrReplace: jest.fn(async () => ({ taskUid: 1 })),
    deleteDocuments: jest.fn(async () => ({ taskUid: 2 })),
    clearIndex: jest.fn(async () => ({ taskUid: 3 })),
    waitForTask: jest.fn(async () => undefined),
  };
  const records = {
    findById: jest.fn(async () => liveRow()),
    markIndexState: jest.fn(async () => undefined),
    markCollectionIndexed: jest.fn(async () => undefined),
    pageLiveByCollection: jest.fn(async () => []),
    findUnsynced: jest.fn(async () => []),
    ...repoOverrides,
  };
  const queue = { add: jest.fn(async () => undefined) };
  const processor = new SearchIndexingProcessor(engine as never, records as never, queue as never);
  return { processor, engine, records, queue };
}

describe('SearchIndexingProcessor', () => {
  it('index-record adds a live row to Meili and marks it INDEXED', async () => {
    const { processor, engine, records } = make();
    await processor.process({ name: 'index-record', data: { id: 'rec-1' } } as Job);
    expect(engine.addOrReplace).toHaveBeenCalledWith(
      'articles',
      [expect.objectContaining({ id: 'rec-1', title: 'Hi' })],
    );
    expect(engine.waitForTask).toHaveBeenCalledWith(1);
    expect(records.markIndexState).toHaveBeenCalledWith(
      'rec-1',
      'INDEXED',
      expect.objectContaining({ indexError: null }),
    );
  });

  it('index-record deletes from Meili when the row is soft-deleted', async () => {
    const { processor, engine } = make({ findById: jest.fn(async () => liveRow({ isDeleted: true })) });
    await processor.process({ name: 'index-record', data: { id: 'rec-1' } } as Job);
    expect(engine.deleteDocuments).toHaveBeenCalledWith('articles', ['rec-1']);
    expect(engine.addOrReplace).not.toHaveBeenCalled();
  });

  it('index-record no-ops when the row is gone', async () => {
    const { processor, engine } = make({ findById: jest.fn(async () => null) });
    await processor.process({ name: 'index-record', data: { id: 'rec-1' } } as Job);
    expect(engine.addOrReplace).not.toHaveBeenCalled();
  });

  it('index-record marks FAILED and rethrows on engine error', async () => {
    const { records } = make();
    const engine = {
      addOrReplace: jest.fn(async () => {
        throw new Error('meili down');
      }),
      deleteDocuments: jest.fn(),
      clearIndex: jest.fn(),
      waitForTask: jest.fn(),
    };
    const proc = new SearchIndexingProcessor(
      engine as never,
      records as never,
      { add: jest.fn() } as never,
    );
    await expect(
      proc.process({ name: 'index-record', data: { id: 'rec-1' } } as Job),
    ).rejects.toThrow('meili down');
    expect(records.markIndexState).toHaveBeenCalledWith(
      'rec-1',
      'FAILED',
      expect.objectContaining({ indexError: 'meili down' }),
    );
  });

  it('delete-record deletes the document by id', async () => {
    const { processor, engine } = make();
    await processor.process({ name: 'delete-record', data: { collection: 'articles', id: 'rec-1' } } as Job);
    expect(engine.deleteDocuments).toHaveBeenCalledWith('articles', ['rec-1']);
  });

  it('reindex-collection clears then reloads live rows in pages', async () => {
    const page1 = [liveRow({ id: 'a' }), liveRow({ id: 'b' })];
    const pager = jest
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce([]);
    const { processor, engine, records } = make({ pageLiveByCollection: pager });
    await processor.process({ name: 'reindex-collection', data: { collection: 'articles' } } as Job);
    expect(engine.clearIndex).toHaveBeenCalledWith('articles');
    expect(engine.addOrReplace).toHaveBeenCalledWith('articles', [
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'b' }),
    ]);
    expect(records.markCollectionIndexed).toHaveBeenCalledWith('articles');
  });

  it('reconcile re-enqueues unsynced records by state', async () => {
    const rows = [liveRow({ id: 'live-1' }), liveRow({ id: 'del-1', isDeleted: true })];
    const { processor, queue } = make({ findUnsynced: jest.fn(async () => rows) });
    await processor.process({ name: 'reconcile', data: {} } as Job);
    expect(queue.add).toHaveBeenCalledWith('index-record', { id: 'live-1' }, expect.anything());
    expect(queue.add).toHaveBeenCalledWith('delete-record', { collection: 'articles', id: 'del-1' }, expect.anything());
  });
});
