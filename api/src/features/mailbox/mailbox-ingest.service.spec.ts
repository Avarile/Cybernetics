import { MailboxIngestService } from './mailbox-ingest.service';

function deps(over: any = {}) {
  const inbox = {
    mailboxState: jest.fn(async () => ({ uidValidity: 10, uidNext: 5 })),
    listUidsSince: jest.fn(async () => [3, 4]),
    fetchForIngest: jest.fn(async (uid: number) => ({
      uid, raw: Buffer.from(`raw${uid}`), messageId: `<m${uid}>`, inReplyTo: null,
      references: undefined, from: { address: 'a@x.com', name: 'A' }, to: [], cc: [],
      subject: `s${uid}`, sentAt: new Date('2020-01-01'), text: 'body', html: null,
      seen: false, sizeBytes: 10, attachments: [],
    })),
    ...over.inbox,
  };
  const repo = {
    getSyncState: jest.fn(async () => null),
    upsertSyncState: jest.fn(async () => ({})),
    findByUid: jest.fn(async () => null),
    insertMessageWithAttachments: jest.fn(async (m: any) => ({ id: `id-${m.uid}`, ...m })),
    ...over.repo,
  };
  const files = { putFromStream: jest.fn(async () => ({ id: 'file-x' })) };
  const search = { persist: jest.fn(async () => []) };
  const config = { getOrThrow: () => ({ batchCap: 200, storeRaw: true, pushFlags: false }) };
  const svc = new MailboxIngestService(inbox as any, repo as any, files as any, search as any, config as any);
  return { svc, inbox, repo, files, search };
}

describe('MailboxIngestService.sync', () => {
  it('persists each new UID and advances the cursor', async () => {
    const { svc, repo, search } = deps();
    const res = await svc.sync('acc', 'INBOX');
    expect(res).toEqual({ processed: 2, batchWasFull: false });
    expect(repo.insertMessageWithAttachments).toHaveBeenCalledTimes(2);
    expect(search.persist).toHaveBeenCalledTimes(2);
    // final sync-state upsert marks ok with lastSeenUid = 4
    expect(repo.upsertSyncState).toHaveBeenLastCalledWith('acc', 'INBOX',
      expect.objectContaining({ lastStatus: 'ok', lastSeenUid: 4 }));
  });

  it('skips UIDs already persisted (idempotent)', async () => {
    const { svc, repo } = deps({ repo: { findByUid: jest.fn(async () => ({ id: 'exists' })) } });
    await svc.sync('acc', 'INBOX');
    expect(repo.insertMessageWithAttachments).not.toHaveBeenCalled();
  });

  it('resets the cursor when server UIDVALIDITY changed', async () => {
    const { svc, inbox } = deps({
      repo: { getSyncState: jest.fn(async () => ({ id: 's', uidValidity: 9, lastSeenUid: 100 })) },
    });
    await svc.sync('acc', 'INBOX');
    // listUidsSince called with 0 because stored uidValidity (9) != server (10)
    expect(inbox.listUidsSince).toHaveBeenCalledWith(0, expect.objectContaining({ mailbox: 'INBOX' }));
  });

  it('marks error and rethrows on failure', async () => {
    const { svc, repo } = deps({
      repo: { insertMessageWithAttachments: jest.fn(async () => { throw new Error('db down'); }) },
    });
    await expect(svc.sync('acc', 'INBOX')).rejects.toThrow('db down');
    expect(repo.upsertSyncState).toHaveBeenLastCalledWith('acc', 'INBOX',
      expect.objectContaining({ lastStatus: 'error' }));
  });
});
