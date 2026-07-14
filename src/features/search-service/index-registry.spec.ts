import type { CollectionRow } from '../../infrastructure/database/schema/search.schema';
import { IndexRegistry } from './index-registry';

function row(name: string): CollectionRow {
  return {
    id: `id-${name}`,
    name,
    displayName: name,
    description: null,
    fields: [{ name: 'title', type: 'string', searchable: true }],
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CollectionRow;
}

function makeRepo(rows: CollectionRow[]) {
  return {
    findByName: jest.fn(async (name: string) => rows.find((r) => r.name === name) ?? null),
    listActive: jest.fn(async () => rows),
  };
}

describe('IndexRegistry', () => {
  it('resolves from the repo on a cache miss and compiles a definition', async () => {
    const repo = makeRepo([row('articles')]);
    const reg = new IndexRegistry(repo as never);
    const compiled = await reg.resolve('articles');
    expect(compiled?.definition.searchableAttributes).toEqual(['title']);
    expect(repo.findByName).toHaveBeenCalledTimes(1);
  });

  it('serves a second resolve from cache without hitting the repo again', async () => {
    const repo = makeRepo([row('articles')]);
    const reg = new IndexRegistry(repo as never);
    await reg.resolve('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown collection', async () => {
    const repo = makeRepo([]);
    const reg = new IndexRegistry(repo as never);
    expect(await reg.resolve('nope')).toBeNull();
  });

  it('invalidate forces a recompile on next resolve', async () => {
    const repo = makeRepo([row('articles')]);
    const reg = new IndexRegistry(repo as never);
    await reg.resolve('articles');
    reg.invalidate('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(2);
  });

  it('warm loads and caches every active collection', async () => {
    const repo = makeRepo([row('a'), row('b')]);
    const reg = new IndexRegistry(repo as never);
    const all = await reg.warm();
    expect(all).toHaveLength(2);
    await reg.resolve('a');
    expect(repo.findByName).not.toHaveBeenCalled();
  });
});
