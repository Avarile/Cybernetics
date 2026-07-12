import { IndexRegistry, type RegisteredIndex } from '../index-registry';
import { SearchReconciliationScheduler } from './search-reconciliation.scheduler';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const withSource: RegisteredIndex = {
  name: 'docs',
  primaryKey: 'id',
  searchableAttributes: [],
  filterableAttributes: [],
  sortableAttributes: [],
  allowedFilterFields: [],
  allowedSortFields: [],
  source: async () => [],
};
const noSource: RegisteredIndex = {
  name: 'bare',
  primaryKey: 'id',
  searchableAttributes: [],
  filterableAttributes: [],
  sortableAttributes: [],
  allowedFilterFields: [],
  allowedSortFields: [],
};

describe('SearchReconciliationScheduler', () => {
  it('enqueues a repeatable reindex only for indexes with a source', async () => {
    const queue = { add: jest.fn(async () => undefined) };
    const registry = new IndexRegistry([withSource, noSource]);
    const scheduler = new SearchReconciliationScheduler(queue as any, registry);

    await scheduler.scheduleReconciliation(1000);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'reindex',
      { index: 'docs' },
      expect.objectContaining({
        repeat: { every: 1000 },
        jobId: 'reindex:docs',
      }),
    );
  });
});
