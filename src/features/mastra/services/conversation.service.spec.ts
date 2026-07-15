import { ConversationService } from './conversation.service';

function make(over: Record<string, any> = {}) {
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'conv-1', ...v })),
    findLiveById: jest.fn(async () => null),
    listByOwner: jest.fn(async () => []),
    touch: jest.fn(async () => undefined),
    ...over,
  };
  return { service: new ConversationService(repo as never), repo };
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
    await expect(service.ensure({ id: 'user-9' }, 'conv-3')).rejects.toThrow();
  });
});
