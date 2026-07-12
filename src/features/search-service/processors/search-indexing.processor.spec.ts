import type { Job } from 'bullmq';
import { IndexRegistry, type RegisteredIndex } from '../index-registry';
import { SearchIndexingProcessor } from './search-indexing.processor';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const docsDef: RegisteredIndex = {
  name: 'docs',
  primaryKey: 'id',
  searchableAttributes: [],
  filterableAttributes: [],
  sortableAttributes: [],
  allowedFilterFields: [],
  allowedSortFields: [],
  source: async () => [{ id: '1' }, { id: '2' }],
};

function makeProcessor() {
  const engine = {
    addOrReplace: jest.fn(async () => ({ taskUid: 1 })),
    deleteDocuments: jest.fn(async () => ({ taskUid: 2 })),
    clearIndex: jest.fn(async () => ({ taskUid: 3 })),
    waitForTask: jest.fn(async () => undefined),
  };
  const registry = new IndexRegistry([docsDef]);
  return {
    processor: new SearchIndexingProcessor(engine as any, registry),
    engine,
  };
}

describe('SearchIndexingProcessor', () => {
  it('applies index-docs and awaits the task', async () => {
    const { processor, engine } = makeProcessor();
    await processor.process({
      name: 'index-docs',
      data: { index: 'docs', docs: [{ id: '1' }] },
    } as Job);
    expect(engine.addOrReplace).toHaveBeenCalledWith('docs', [{ id: '1' }]);
    expect(engine.waitForTask).toHaveBeenCalledWith(1);
  });

  it('applies delete-docs', async () => {
    const { processor, engine } = makeProcessor();
    await processor.process({
      name: 'delete-docs',
      data: { index: 'docs', ids: ['1'] },
    } as Job);
    expect(engine.deleteDocuments).toHaveBeenCalledWith('docs', ['1']);
    expect(engine.waitForTask).toHaveBeenCalledWith(2);
  });

  it('reindex clears then re-adds from the source', async () => {
    const { processor, engine } = makeProcessor();
    await processor.process({
      name: 'reindex',
      data: { index: 'docs' },
    } as Job);
    expect(engine.clearIndex).toHaveBeenCalledWith('docs');
    expect(engine.addOrReplace).toHaveBeenCalledWith('docs', [
      { id: '1' },
      { id: '2' },
    ]);
  });
});
