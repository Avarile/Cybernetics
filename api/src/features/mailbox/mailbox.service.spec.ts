import { NotFoundException } from '@nestjs/common';
import { MailboxService } from './mailbox.service';

function make(over: any = {}) {
  const repo = {
    listMessages: jest.fn(async () => ({ rows: [], total: 0 })),
    findByIdWithAttachments: jest.fn(async () => null),
    findAttachment: jest.fn(async () => null),
    setSeen: jest.fn(async () => null),
    ...over.repo,
  };
  const files = { getDownloadUrl: jest.fn(async () => ({ url: 'https://x' })) };
  const search = { persist: jest.fn(async () => []) };
  const collections = {
    get: jest.fn(async () => ({})),
    create: jest.fn(async () => ({})),
  };
  const scheduler = { enqueueSync: jest.fn(async () => undefined) };
  const config = {
    getOrThrow: () => ({ defaultAccountId: 'acc-default', mailbox: 'INBOX' }),
  };
  const svc = new MailboxService(
    repo as any,
    files as any,
    search as any,
    collections as any,
    scheduler as any,
    config as any,
  );
  return { svc, repo, files, search, collections, scheduler };
}

describe('MailboxService', () => {
  it('get throws NotFound when the message is absent', async () => {
    const { svc } = make();
    await expect(svc.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('markSeen updates the row and re-persists the search doc', async () => {
    const row = {
      id: 'm1',
      accountId: 'acc',
      mailbox: 'INBOX',
      subject: 's',
      bodyText: 'b',
      fromAddress: 'a@x.com',
      fromName: null,
      threadId: '<t>',
      seen: true,
      flagged: false,
      receivedAt: new Date('2020-01-01'),
      sentAt: null,
    };
    const { svc, repo, search } = make({
      repo: { setSeen: jest.fn(async () => row) },
    });
    await svc.markSeen('m1', true);
    expect(repo.setSeen).toHaveBeenCalledWith('m1', true);
    expect(search.persist).toHaveBeenCalledWith('inbound_email', [
      expect.objectContaining({ externalId: 'm1' }),
    ]);
  });

  it('resolveAccountId prefers the explicit arg then the config default', () => {
    const { svc } = make();
    expect(svc.resolveAccountId('explicit')).toBe('explicit');
    expect(svc.resolveAccountId()).toBe('acc-default');
  });
});
