import {
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import { GUEST_PRINCIPAL, type Principal } from '../../../common/principal';
import { ConversationService } from './conversation.service';

const user: Principal = { kind: 'user', userId: 'user-9', role: 'user' };
const otherUser: Principal = { kind: 'user', userId: 'user-8', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'admin-1', role: 'admin' };
const service_: Principal = {
  kind: 'service',
  credentialId: 'svc-1',
  role: 'agent',
};

function make(over: Record<string, any> = {}) {
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'conv-1', ...v })),
    findLiveById: jest.fn(async () => null),
    findLivePublicById: jest.fn(async () => null),
    listByOwner: jest.fn(async () => ({ rows: [], total: 0 })),
    rename: jest.fn(async () => undefined),
    setStatus: jest.fn(async () => undefined),
    softDelete: jest.fn(async () => undefined),
    touch: jest.fn(async () => undefined),
    ...over,
  };
  delete (repo as Record<string, unknown>).threads;
  // The thread-purge port, not MastraService: ConversationService takes the
  // narrow THREAD_STORE interface so this file never loads `@mastra/nestjs`,
  // which is ESM-only and would fail the whole suite at import time.
  const threads = over.threads ?? {
    deleteThread: jest.fn(async () => undefined),
  };
  return {
    service: new ConversationService(
      repo as never,
      new ExceptionService(),
      undefined,
      threads,
    ),
    repo,
    threads,
  };
}

describe('ConversationService.ensure', () => {
  it('creates a new conversation owned by the principal when no id given', async () => {
    const { service, repo } = make();
    const conv = await service.ensure(user);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-9',
        resourceId: 'user-9',
        kind: 'chat',
      }),
    );
    expect(conv.id).toBe('conv-1');
  });

  it('returns the existing conversation when the principal owns it', async () => {
    const { service } = make({
      findLiveById: jest.fn(async () => ({
        id: 'conv-2',
        ownerUserId: 'user-9',
      })),
    });
    const conv = await service.ensure(user, 'conv-2');
    expect(conv.id).toBe('conv-2');
  });

  it('403s when the principal does not own the conversation', async () => {
    const { service } = make({
      findLiveById: jest.fn(async () => ({
        id: 'conv-3',
        ownerUserId: 'someone-else',
      })),
    });
    await expect(service.ensure(user, 'conv-3')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Not your conversation',
    });
  });
});

describe('ConversationService.listForOwner', () => {
  const row = (over: Record<string, any> = {}) => ({
    id: 'conv-1',
    ownerUserId: 'user-9',
    resourceId: 'user-9',
    title: null,
    generatedTitle: null,
    kind: 'chat',
    status: 'active',
    lastMessageAt: new Date('2026-07-28T00:30:30Z'),
    messageCount: 2,
    metadata: { secret: true },
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-07-28T00:30:21Z'),
    updatedAt: new Date('2026-07-28T00:30:30Z'),
    ...over,
  });
  const withRows = (rows: any[], total = rows.length) =>
    make({ listByOwner: jest.fn(async () => ({ rows, total })) });

  it('returns a { data, total, page, limit } envelope, not a bare array', async () => {
    const { service } = withRows([row()], 7);
    const res = await service.listForOwner(user, 2, 30);
    expect(Array.isArray(res)).toBe(false);
    expect(res).toMatchObject({ total: 7, page: 2, limit: 30 });
    expect(res.data).toHaveLength(1);
  });

  it('returns an empty envelope for an anonymous principal without hitting the repo', async () => {
    const { service, repo } = withRows([row()]);
    expect(await service.listForOwner(GUEST_PRINCIPAL, 3, 15)).toEqual({
      data: [],
      total: 0,
      page: 3,
      limit: 15,
    });
    expect(repo.listByOwner).not.toHaveBeenCalled();
  });

  it('passes the owner id, page and limit through to the repository', async () => {
    const { service, repo } = withRows([]);
    await service.listForOwner(user, 2, 30);
    // 'active' is the default shelf: archiving must hide a conversation from the
    // rail without an explicit filter at the call site.
    expect(repo.listByOwner).toHaveBeenCalledWith('user-9', 2, 30, 'active');
  });

  it('forwards an explicit status filter', async () => {
    const { service, repo } = withRows([]);
    await service.listForOwner(user, 1, 20, 'archived');
    expect(repo.listByOwner).toHaveBeenCalledWith('user-9', 1, 20, 'archived');
  });

  it('falls back to the Mastra-generated title when no explicit title is set', async () => {
    const { service } = withRows([
      row({ title: null, generatedTitle: 'Friendly Greeting from User' }),
    ]);
    const { data } = await service.listForOwner(user);
    expect(data[0].title).toBe('Friendly Greeting from User');
  });

  it('prefers an explicit title over the Mastra-generated one', async () => {
    const { service } = withRows([
      row({ title: 'Renamed by user', generatedTitle: 'Whatever Mastra said' }),
    ]);
    const { data } = await service.listForOwner(user);
    expect(data[0].title).toBe('Renamed by user');
  });

  it('sanitises an over-long generated title instead of leaking the whole reply', async () => {
    const { service } = withRows([
      row({ generatedTitle: `It looks like\nyour ${'test '.repeat(60)}` }),
    ]);
    const { data } = await service.listForOwner(user);
    // <= 80 rather than == 80: trimEnd drops a trailing space at the cut point.
    expect((data[0].title as string).length).toBeLessThanOrEqual(80);
    expect(data[0].title).toMatch(/^It looks like your test .*…$/);
  });

  it('nulls the title when neither source has usable text', async () => {
    const { service } = withRows([row({ title: '   ', generatedTitle: null })]);
    const { data } = await service.listForOwner(user);
    expect(data[0].title).toBeNull();
  });

  it('projects only client-facing fields, never ownership or internals', async () => {
    const { service } = withRows([row()]);
    const { data } = await service.listForOwner(user);
    expect(Object.keys(data[0]).sort()).toEqual([
      'agentId',
      'createdAt',
      'id',
      'kind',
      'lastMessageAt',
      'messageCount',
      'status',
      'title',
      'updatedAt',
    ]);
  });
});

describe('ConversationService access control', () => {
  const owned = (ownerUserId: string | null) =>
    make({
      findLiveById: jest.fn(async () => ({ id: 'conv-x', ownerUserId })),
    });

  // The regression this whole change exists for. The old predicate was
  // `principal.id && conv.ownerUserId && conv.ownerUserId !== principal.id`,
  // which short-circuits to "allowed" whenever the row has no owner — and
  // system/scheduled runs create exactly those rows.
  it('denies a NULL-owner conversation to an ordinary user', async () => {
    const { service } = owned(null);
    await expect(service.getOwned(user, 'conv-x')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('denies a NULL-owner conversation on the ensure/continue path too', async () => {
    // `ensure` is what POST /agent/chat calls, and ApprovalService.decide gates
    // on getOwned — so both the read and the tool-approval paths close together.
    const { service } = owned(null);
    await expect(service.ensure(user, 'conv-x')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('denies another user’s conversation', async () => {
    const { service } = owned('user-9');
    await expect(service.getOwned(otherUser, 'conv-x')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('allows the owner', async () => {
    const { service } = owned('user-9');
    await expect(service.getOwned(user, 'conv-x')).resolves.toMatchObject({
      id: 'conv-x',
    });
  });

  it('allows an admin, including on a NULL-owner conversation', async () => {
    const { service } = owned(null);
    await expect(service.getOwned(admin, 'conv-x')).resolves.toMatchObject({
      id: 'conv-x',
    });
  });

  it('denies a service credential, and never writes its id as an owner', async () => {
    const { service } = owned(null);
    await expect(service.getOwned(service_, 'conv-x')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });

    // `owner_user_id` references `users.id`; a service_credentials.id there is
    // an FK violation, so it must be stored as NULL.
    const fresh = make();
    await fresh.service.ensure(service_);
    expect(fresh.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: null }),
    );
  });

  it('404s a missing conversation before any ownership check', async () => {
    const { service } = make();
    await expect(service.getOwned(user, 'nope')).rejects.toMatchObject({
      code: ErrorCode.AGENT_CONVERSATION_NOT_FOUND,
    });
  });
});

describe('ConversationService admin read auditing', () => {
  const withAudit = (ownerUserId: string | null) => {
    const audit = { record: jest.fn(async () => undefined) };
    const repo = {
      create: jest.fn(async (v: any) => ({ id: 'conv-1', ...v })),
      findLiveById: jest.fn(async () => ({ id: 'conv-x', ownerUserId })),
      listByOwner: jest.fn(async () => ({ rows: [], total: 0 })),
      touch: jest.fn(async () => undefined),
    };
    return {
      service: new ConversationService(
        repo as never,
        new ExceptionService(),
        audit as never,
      ),
      audit,
    };
  };

  it('records an audit entry when an admin reads someone else’s conversation', async () => {
    const { service, audit } = withAudit('user-9');
    await service.getOwned(admin, 'conv-x');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'conversation.admin_read',
        entityType: 'conversation',
        entityId: 'conv-x',
        ctx: { actorId: 'admin-1' },
        metadata: { ownerUserId: 'user-9' },
      }),
    );
  });

  it('records the read of an unowned (system) conversation too', async () => {
    const { service, audit } = withAudit(null);
    await service.getOwned(admin, 'conv-x');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('does not audit an admin reading their own conversation', async () => {
    const { service, audit } = withAudit('admin-1');
    await service.getOwned(admin, 'conv-x');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not audit an ordinary user reading their own conversation', async () => {
    const audit = { record: jest.fn() };
    const repo = {
      findLiveById: jest.fn(async () => ({
        id: 'conv-x',
        ownerUserId: 'user-9',
      })),
    };
    const service = new ConversationService(
      repo as never,
      new ExceptionService(),
      audit as never,
    );
    await service.getOwned(user, 'conv-x');
    expect(audit.record).not.toHaveBeenCalled();
  });

  // The audit trail is a nice-to-have; access control is not. A context without
  // SystemAuditModule (module-subset e2e) must still authorize correctly.
  it('works without an audit service injected', async () => {
    const repo = {
      findLiveById: jest.fn(async () => ({ id: 'conv-x', ownerUserId: 'u' })),
    };
    const service = new ConversationService(
      repo as never,
      new ExceptionService(),
    );
    await expect(service.getOwned(admin, 'conv-x')).resolves.toBeDefined();
    await expect(service.getOwned(user, 'conv-x')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });
});

describe('ConversationService agent binding', () => {
  it('binds a new conversation to the default agent', async () => {
    const { service, repo } = make();
    await service.ensure(user);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'assistant' }),
    );
  });

  it('binds a new conversation to an explicitly chosen agent', async () => {
    const { service, repo } = make();
    await service.ensure(user, undefined, 'chat', 'orchestrator');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'orchestrator' }),
    );
  });

  /**
   * The lock. Mastra memory is per-thread, so re-pointing a live conversation at
   * another agent would hand a different persona the first one's working memory
   * and history. A stale client tab must not be able to do that.
   */
  it('ignores a requested agent on an existing conversation', async () => {
    const { service } = make({
      findLiveById: jest.fn(async () => ({
        id: 'conv-2',
        ownerUserId: 'user-9',
        agentId: 'assistant',
      })),
    });
    const conv = await service.ensure(user, 'conv-2', 'chat', 'orchestrator');
    expect(conv.agentId).toBe('assistant');
  });
});

describe('ConversationService.rename', () => {
  const owned = {
    id: 'conv-1',
    ownerUserId: 'user-9',
    agentId: 'assistant',
    kind: 'chat',
    status: 'active',
    title: null,
    lastMessageAt: null,
    messageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('sanitises the title before storing it', async () => {
    const { service, repo } = make({
      findLiveById: jest.fn(async () => owned),
      findLivePublicById: jest.fn(async () => ({
        ...owned,
        generatedTitle: null,
      })),
    });
    await service.rename(user, 'conv-1', '  Quarterly   review  ');
    expect(repo.rename).toHaveBeenCalledWith('conv-1', 'Quarterly review');
  });

  /**
   * Blank must store null, not ''. Null restores the fallback to Mastra's
   * generated title; an empty string would pin the rail to "Untitled" forever.
   */
  it('stores null for a blank title so the generated one returns', async () => {
    const { service, repo } = make({
      findLiveById: jest.fn(async () => owned),
      findLivePublicById: jest.fn(async () => ({
        ...owned,
        generatedTitle: 'Mastra said this',
      })),
    });
    const result = await service.rename(user, 'conv-1', '   ');
    expect(repo.rename).toHaveBeenCalledWith('conv-1', null);
    expect(result.title).toBe('Mastra said this');
  });

  it('403s for a non-owner', async () => {
    const { service, repo } = make({
      findLiveById: jest.fn(async () => ({ ...owned, ownerUserId: 'user-8' })),
    });
    await expect(service.rename(user, 'conv-1', 'nope')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(repo.rename).not.toHaveBeenCalled();
  });
});

describe('ConversationService.remove', () => {
  const owned = { id: 'conv-1', ownerUserId: 'user-9', agentId: 'assistant' };

  it('soft-deletes the row and purges the Mastra thread', async () => {
    const { service, repo, threads } = make({
      findLiveById: jest.fn(async () => owned),
    });
    await service.remove(user, 'conv-1');
    expect(repo.softDelete).toHaveBeenCalledWith('conv-1');
    expect(threads.deleteThread).toHaveBeenCalledWith('conv-1');
  });

  /**
   * The tombstone is what the audit ledger hangs off — `agent_run` and
   * `agent_approval` hold FKs to it — so a purge failure must not be reported as
   * a failed delete for a conversation the user can no longer see.
   */
  it('still succeeds when the thread purge throws', async () => {
    const { service, repo } = make({
      findLiveById: jest.fn(async () => owned),
      threads: {
        deleteThread: jest.fn(async () => {
          throw new Error('storage down');
        }),
      },
    });
    await expect(service.remove(user, 'conv-1')).resolves.toBeUndefined();
    // The tombstone still landed — that is the half that must not be lost.
    expect(repo.softDelete).toHaveBeenCalledWith('conv-1');
  });

  it('403s for a non-owner and deletes nothing', async () => {
    const { service, repo, threads } = make({
      findLiveById: jest.fn(async () => ({ ...owned, ownerUserId: 'user-8' })),
    });
    await expect(service.remove(user, 'conv-1')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(threads.deleteThread).not.toHaveBeenCalled();
  });
});

describe('ConversationService.setStatus', () => {
  const owned = {
    id: 'conv-1',
    ownerUserId: 'user-9',
    agentId: 'assistant',
    kind: 'chat',
    status: 'active',
    title: 'T',
    lastMessageAt: null,
    messageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('archives an owned conversation', async () => {
    const { service, repo } = make({
      findLiveById: jest.fn(async () => owned),
      findLivePublicById: jest.fn(async () => ({
        ...owned,
        status: 'archived',
        generatedTitle: null,
      })),
    });
    const result = await service.setStatus(user, 'conv-1', 'archived');
    expect(repo.setStatus).toHaveBeenCalledWith('conv-1', 'archived');
    expect(result.status).toBe('archived');
  });

  it('403s for a non-owner', async () => {
    const { service, repo } = make({
      findLiveById: jest.fn(async () => ({ ...owned, ownerUserId: 'user-8' })),
    });
    await expect(
      service.setStatus(user, 'conv-1', 'archived'),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(repo.setStatus).not.toHaveBeenCalled();
  });
});
