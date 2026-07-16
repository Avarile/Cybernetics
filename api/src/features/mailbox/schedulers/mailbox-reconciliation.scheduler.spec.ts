import { MailboxReconciliationScheduler } from './mailbox-reconciliation.scheduler';

function make(cfg: { defaultAccountId?: string | null; mailbox?: string }) {
  const queue = {
    upsertJobScheduler: jest.fn(async () => undefined),
    add: jest.fn(async () => undefined),
  };
  const config = {
    getOrThrow: jest.fn(() => ({
      pollIntervalMs: 300_000,
      batchCap: 200,
      storeRaw: true,
      pushFlags: false,
      defaultAccountId: null,
      mailbox: 'INBOX',
      ...cfg,
    })),
  };
  return {
    scheduler: new MailboxReconciliationScheduler(
      queue as never,
      config as never,
    ),
    queue,
    config,
  };
}

describe('MailboxReconciliationScheduler', () => {
  describe('onApplicationBootstrap', () => {
    it('does not register a sweep when defaultAccountId is unset', async () => {
      const { scheduler, queue } = make({ defaultAccountId: null });
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('does not register a sweep when defaultAccountId is empty', async () => {
      const { scheduler, queue } = make({ defaultAccountId: '' });
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('registers an idempotent job scheduler when defaultAccountId is set', async () => {
      const { scheduler, queue } = make({
        defaultAccountId: 'acc-1',
        mailbox: 'INBOX',
      });
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'mailbox-reconcile:acc-1:INBOX',
        { every: 6 * 60 * 60 * 1000 },
        expect.objectContaining({
          name: 'reconcile-mailbox',
          data: { accountId: 'acc-1', mailbox: 'INBOX' },
        }),
      );
    });
  });
});
