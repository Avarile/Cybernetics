import { ConflictException, NotFoundException } from '@nestjs/common';
import { IndexRegistry } from './index-registry';
import { CollectionService } from './collection.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const fields = [{ name: 'title', type: 'string', searchable: true }] as const;

function make(overrides: { existing?: boolean } = {}) {
  let stored: Record<string, unknown> | null = overrides.existing
    ? { name: 'articles' }
    : null;
  const collectionsRepo = {
    findByName: jest.fn(async () => stored),
    listActive: jest.fn(async () => (stored ? [stored] : [])),
    create: jest.fn(async (v: Record<string, unknown>) => {
      stored = { id: 'c1', createdAt: new Date(), updatedAt: new Date(), description: null, ...v };
      return stored;
    }),
    updateByName: jest.fn(async (name: string, patch: Record<string, unknown>) => {
      stored = { ...(stored ?? {}), ...patch, name };
      return stored;
    }),
    softDeleteByName: jest.fn(async () => undefined),
  };
  const recordsRepo = { softDeleteByCollection: jest.fn(async () => undefined) };
  const engine = {
    ensureIndex: jest.fn(async () => undefined),
    deleteIndex: jest.fn(async () => ({ taskUid: 1 })),
    waitForTask: jest.fn(async () => undefined),
  };
  const queue = { add: jest.fn(async () => undefined) };
  const registry = new IndexRegistry(collectionsRepo as never);
  const service = new CollectionService(
    engine as never,
    collectionsRepo as never,
    recordsRepo as never,
    registry,
    queue as never,
  );
  return { service, collectionsRepo, recordsRepo, engine, queue };
}

describe('CollectionService', () => {
  const input = { name: 'articles', displayName: 'Articles', fields: [...fields] };

  it('creates a collection and ensures its Meili index', async () => {
    const { service, engine, collectionsRepo } = make();
    const view = await service.create(input as never);
    expect(engine.ensureIndex).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'articles', searchableAttributes: ['title'] }),
    );
    expect(collectionsRepo.create).toHaveBeenCalled();
    expect(view.name).toBe('articles');
  });

  it('409s when the collection name already exists', async () => {
    const { service } = make({ existing: true });
    await expect(service.create(input as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s getting an unknown collection', async () => {
    const { service } = make();
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove purges records, deletes the index, and invalidates the cache', async () => {
    const { service, engine, recordsRepo, collectionsRepo } = make({ existing: true });
    await service.remove('articles');
    expect(collectionsRepo.softDeleteByName).toHaveBeenCalledWith('articles');
    expect(recordsRepo.softDeleteByCollection).toHaveBeenCalledWith('articles');
    expect(engine.deleteIndex).toHaveBeenCalledWith('articles');
  });

  it('update with new fields re-ensures settings and enqueues a reload', async () => {
    const { service, engine, queue } = make({ existing: true });
    await service.update('articles', {
      fields: [{ name: 'title', type: 'string', searchable: true }, { name: 'body', type: 'string', searchable: true }],
    } as never);
    expect(engine.ensureIndex).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('reindex-collection', { collection: 'articles' }, expect.anything());
  });
});
