import { SearchReconciliationScheduler } from './search-reconciliation.scheduler';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

describe('SearchReconciliationScheduler', () => {
  it('registers a single repeatable reconcile job', async () => {
    const queue = { add: jest.fn(async () => undefined) };
    const scheduler = new SearchReconciliationScheduler(queue as never);

    await scheduler.scheduleReconciliation(1000);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile',
      {},
      expect.objectContaining({ repeat: { every: 1000 }, jobId: 'search-reconcile' }),
    );
  });
});
