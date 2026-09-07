import { ApiError, UsageError } from '../errors';
import { keyBackedField, mapKeyBackedFields, resolveKeyBackedValue } from './key-backed-submit';
import type { KeyBackedField, VocabularyIndex } from './vocabulary';

const TYPE_FIELD: KeyBackedField = { bufferField: 'type', dtoField: 'typeId', many: false, kind: 'contact-type' };
const TAGS_FIELD: KeyBackedField = {
  bufferField: 'tags',
  dtoField: 'tagIds',
  many: true,
  kind: 'tag',
  scope: 'contact',
};

function vocab(overrides: Partial<VocabularyIndex> = {}): VocabularyIndex {
  return {
    toId: jest.fn().mockResolvedValue('resolved-id'),
    toIds: jest.fn().mockResolvedValue(['id-1', 'id-2']),
    toKey: jest.fn(),
    toKeys: jest.fn(),
    ...overrides,
  } as unknown as VocabularyIndex;
}

describe('resolveKeyBackedValue', () => {
  it('resolves a scalar value via toId', async () => {
    const v = vocab();
    const result = await resolveKeyBackedValue(TYPE_FIELD, 'customer', v);
    expect(v.toId).toHaveBeenCalledWith(TYPE_FIELD, 'customer');
    expect(result).toBe('resolved-id');
  });

  it('returns null for an empty/absent scalar without calling toId', async () => {
    const v = vocab();
    expect(await resolveKeyBackedValue(TYPE_FIELD, '', v)).toBeNull();
    expect(await resolveKeyBackedValue(TYPE_FIELD, null, v)).toBeNull();
    expect(await resolveKeyBackedValue(TYPE_FIELD, undefined, v)).toBeNull();
    expect(v.toId).not.toHaveBeenCalled();
  });

  it('resolves a many value via toIds, dropping empty entries', async () => {
    const v = vocab();
    const result = await resolveKeyBackedValue(TAGS_FIELD, ['security', '', 'urgent'], v);
    expect(v.toIds).toHaveBeenCalledWith(TAGS_FIELD, ['security', 'urgent']);
    expect(result).toEqual(['id-1', 'id-2']);
  });

  it('returns [] for an empty many value without calling toIds', async () => {
    const v = vocab();
    expect(await resolveKeyBackedValue(TAGS_FIELD, [], v)).toEqual([]);
    expect(v.toIds).not.toHaveBeenCalled();
  });

  it('wraps a resolution UsageError as an ApiError with one issue naming the buffer field', async () => {
    const v = vocab({
      toId: jest.fn().mockRejectedValue(new UsageError('Unknown contact type key "bogus". See: cyb contacts type ls')),
    });

    const err = await resolveKeyBackedValue(TYPE_FIELD, 'bogus', v).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).issues).toEqual([
      { path: ['type'], message: 'Unknown contact type key "bogus". See: cyb contacts type ls' },
    ]);
    expect((err as ApiError).exitCode).toBe(2);
  });

  it('lets a non-UsageError propagate unwrapped', async () => {
    const boom = new Error('network exploded');
    const v = vocab({ toId: jest.fn().mockRejectedValue(boom) });

    await expect(resolveKeyBackedValue(TYPE_FIELD, 'customer', v)).rejects.toBe(boom);
  });
});

describe('mapKeyBackedFields', () => {
  it('renames a present buffer field to its dtoField, resolved', async () => {
    const v = vocab();
    const dto: Record<string, unknown> = { displayName: 'Ada', type: 'customer' };

    await mapKeyBackedFields([TYPE_FIELD], dto, v);

    expect(dto).toEqual({ displayName: 'Ada', typeId: 'resolved-id' });
  });

  it('leaves dto untouched when the buffer field is absent', async () => {
    const v = vocab();
    const dto: Record<string, unknown> = { displayName: 'Ada' };

    await mapKeyBackedFields([TYPE_FIELD], dto, v);

    expect(dto).toEqual({ displayName: 'Ada' });
    expect(v.toId).not.toHaveBeenCalled();
  });

  it('sends an empty many list rather than omitting it', async () => {
    const v = vocab();
    const dto: Record<string, unknown> = { tags: [] };

    await mapKeyBackedFields([TAGS_FIELD], dto, v);

    expect(dto).toEqual({ tagIds: [] });
  });

  it('omits the dtoField when a scalar resolves to null (cleared/empty)', async () => {
    const v = vocab();
    const dto: Record<string, unknown> = { type: '' };

    await mapKeyBackedFields([TYPE_FIELD], dto, v);

    expect(dto).toEqual({});
  });
});

describe('keyBackedField', () => {
  it('finds a field by buffer name', () => {
    expect(keyBackedField([TYPE_FIELD, TAGS_FIELD], 'tags')).toBe(TAGS_FIELD);
  });

  it('throws on a name not present -- a bug in the caller, not a user mistake', () => {
    expect(() => keyBackedField([TYPE_FIELD], 'company')).toThrow(/company/);
  });
});
