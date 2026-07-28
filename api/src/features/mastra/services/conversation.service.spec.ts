import {
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import { ConversationService } from './conversation.service';

function make(over: Record<string, any> = {}) {
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'conv-1', ...v })),
    findLiveById: jest.fn(async () => null),
    listByOwner: jest.fn(async () => ({ rows: [], total: 0 })),
    touch: jest.fn(async () => undefined),
    ...over,
  };
  return {
    service: new ConversationService(repo as never, new ExceptionService()),
    repo,
  };
}

describe('ConversationService.ensure', () => {
  it('creates a new conversation owned by the principal when no id given', async () => {
    const { service, repo } = make();
    const conv = await service.ensure({ id: 'user-9' });
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
    const conv = await service.ensure({ id: 'user-9' }, 'conv-2');
    expect(conv.id).toBe('conv-2');
  });

  it('403s when the principal does not own the conversation', async () => {
    const { service } = make({
      findLiveById: jest.fn(async () => ({
        id: 'conv-3',
        ownerUserId: 'someone-else',
      })),
    });
    await expect(
      service.ensure({ id: 'user-9' }, 'conv-3'),
    ).rejects.toMatchObject({
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
    const res = await service.listForOwner({ id: 'user-9' }, 2, 30);
    expect(Array.isArray(res)).toBe(false);
    expect(res).toMatchObject({ total: 7, page: 2, limit: 30 });
    expect(res.data).toHaveLength(1);
  });

  it('returns an empty envelope for an anonymous principal without hitting the repo', async () => {
    const { service, repo } = withRows([row()]);
    expect(await service.listForOwner({ id: null }, 3, 15)).toEqual({
      data: [],
      total: 0,
      page: 3,
      limit: 15,
    });
    expect(repo.listByOwner).not.toHaveBeenCalled();
  });

  it('passes the owner id, page and limit through to the repository', async () => {
    const { service, repo } = withRows([]);
    await service.listForOwner({ id: 'user-9' }, 2, 30);
    expect(repo.listByOwner).toHaveBeenCalledWith('user-9', 2, 30);
  });

  it('falls back to the Mastra-generated title when no explicit title is set', async () => {
    const { service } = withRows([
      row({ title: null, generatedTitle: 'Friendly Greeting from User' }),
    ]);
    const { data } = await service.listForOwner({ id: 'user-9' });
    expect(data[0].title).toBe('Friendly Greeting from User');
  });

  it('prefers an explicit title over the Mastra-generated one', async () => {
    const { service } = withRows([
      row({ title: 'Renamed by user', generatedTitle: 'Whatever Mastra said' }),
    ]);
    const { data } = await service.listForOwner({ id: 'user-9' });
    expect(data[0].title).toBe('Renamed by user');
  });

  it('sanitises an over-long generated title instead of leaking the whole reply', async () => {
    const { service } = withRows([
      row({ generatedTitle: `It looks like\nyour ${'test '.repeat(60)}` }),
    ]);
    const { data } = await service.listForOwner({ id: 'user-9' });
    // <= 80 rather than == 80: trimEnd drops a trailing space at the cut point.
    expect((data[0].title as string).length).toBeLessThanOrEqual(80);
    expect(data[0].title).toMatch(/^It looks like your test .*…$/);
  });

  it('nulls the title when neither source has usable text', async () => {
    const { service } = withRows([row({ title: '   ', generatedTitle: null })]);
    const { data } = await service.listForOwner({ id: 'user-9' });
    expect(data[0].title).toBeNull();
  });

  it('projects only client-facing fields, never ownership or internals', async () => {
    const { service } = withRows([row()]);
    const { data } = await service.listForOwner({ id: 'user-9' });
    expect(Object.keys(data[0]).sort()).toEqual([
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
