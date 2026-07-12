import { IndexRegistry, type RegisteredIndex } from './index-registry';

function def(name: string): RegisteredIndex {
  return {
    name,
    primaryKey: 'id',
    searchableAttributes: [],
    filterableAttributes: [],
    sortableAttributes: [],
    allowedFilterFields: [],
    allowedSortFields: [],
  };
}

describe('IndexRegistry', () => {
  it('indexes definitions by name', () => {
    const reg = new IndexRegistry([def('a'), def('b')]);
    expect(reg.has('a')).toBe(true);
    expect(reg.get('b')?.primaryKey).toBe('id');
    expect(reg.all()).toHaveLength(2);
  });

  it('rejects duplicate names', () => {
    expect(() => new IndexRegistry([def('a'), def('a')])).toThrow(/Duplicate/);
  });

  it('returns undefined for unknown names', () => {
    expect(new IndexRegistry([]).get('nope')).toBeUndefined();
  });
});
