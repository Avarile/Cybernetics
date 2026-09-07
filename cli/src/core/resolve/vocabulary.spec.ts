import type { ApiClient } from '../http/api.client';
import { ApiError, UsageError } from '../errors';
import { KEY_BACKED_FIELDS, VocabularyIndex, type KeyBackedField } from './vocabulary';

const CONTACT_TYPE_FIELD: KeyBackedField = {
  bufferField: 'type',
  dtoField: 'typeId',
  many: false,
  kind: 'contact-type',
};

const CONTACT_TAG_FIELD: KeyBackedField = {
  bufferField: 'tags',
  dtoField: 'tagIds',
  many: true,
  kind: 'tag',
  scope: 'contact',
};

const KNOWLEDGE_TAG_FIELD: KeyBackedField = {
  bufferField: 'tags',
  dtoField: 'tagIds',
  many: true,
  kind: 'tag',
  scope: 'knowledge',
};

const COMPANY_FIELD: KeyBackedField = {
  bufferField: 'company',
  dtoField: 'companyId',
  many: false,
  kind: 'company',
};

const UUID = '11111111-2222-3333-4444-555555555555';

function client(get: jest.Mock): ApiClient {
  return { get } as unknown as ApiClient;
}

/** `promise.catch((e) => e)` widens to `T | Error`; this keeps the rejection typed as `Error`. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('KEY_BACKED_FIELDS', () => {
  it('declares contact fields: type, category, tags (scope: contact), company', () => {
    const fields = KEY_BACKED_FIELDS.contact;
    expect(fields.find((f) => f.bufferField === 'type')).toMatchObject({
      dtoField: 'typeId',
      many: false,
      kind: 'contact-type',
    });
    expect(fields.find((f) => f.bufferField === 'category')).toMatchObject({
      dtoField: 'categoryId',
      many: false,
      kind: 'contact-category',
    });
    expect(fields.find((f) => f.bufferField === 'tags')).toMatchObject({
      dtoField: 'tagIds',
      many: true,
      kind: 'tag',
      scope: 'contact',
    });
    expect(fields.find((f) => f.bufferField === 'company')).toMatchObject({
      dtoField: 'companyId',
      many: false,
      kind: 'company',
    });
  });

  it('declares knowledge fields: type, category, tags (scope: knowledge) — no company', () => {
    const fields = KEY_BACKED_FIELDS.knowledge;
    expect(fields.find((f) => f.bufferField === 'type')).toMatchObject({
      dtoField: 'typeId',
      kind: 'knowledge-type',
    });
    expect(fields.find((f) => f.bufferField === 'category')).toMatchObject({
      dtoField: 'categoryId',
      kind: 'knowledge-category',
    });
    expect(fields.find((f) => f.bufferField === 'tags')).toMatchObject({
      dtoField: 'tagIds',
      many: true,
      kind: 'tag',
      scope: 'knowledge',
    });
    expect(fields.find((f) => f.bufferField === 'company')).toBeUndefined();
  });
});

describe('VocabularyIndex.toId — UUID passthrough', () => {
  it('passes a well-formed UUID through toId with zero HTTP calls, for every kind', async () => {
    const fields = [CONTACT_TYPE_FIELD, CONTACT_TAG_FIELD, COMPANY_FIELD];
    for (const field of fields) {
      const get = jest.fn();
      const index = new VocabularyIndex(client(get));
      await expect(index.toId(field, UUID)).resolves.toBe(UUID);
      expect(get).not.toHaveBeenCalled();
    }
  });
});

describe('VocabularyIndex — bounded vocabulary (contact-type)', () => {
  it('fetches /contact-vocabulary/types once across two toId lookups', async () => {
    const get = jest.fn().mockResolvedValue([
      { id: 'ct-1', key: 'customer', name: 'Customer', description: null },
      { id: 'ct-2', key: 'vendor', name: 'Vendor', description: null },
    ]);
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(CONTACT_TYPE_FIELD, 'customer')).resolves.toBe('ct-1');
    await expect(index.toId(CONTACT_TYPE_FIELD, 'vendor')).resolves.toBe('ct-2');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/contact-vocabulary/types');
  });

  it('toKey reverse-maps id to key from the same cached fetch', async () => {
    const get = jest.fn().mockResolvedValue([
      { id: 'ct-1', key: 'customer', name: 'Customer', description: null },
    ]);
    const index = new VocabularyIndex(client(get));

    await expect(index.toKey(CONTACT_TYPE_FIELD, 'ct-1')).resolves.toBe('customer');
    await expect(index.toKey(CONTACT_TYPE_FIELD, 'ct-1')).resolves.toBe('customer');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('toKey on an unresolvable id returns the raw id rather than throwing', async () => {
    const get = jest.fn().mockResolvedValue([
      { id: 'ct-1', key: 'customer', name: 'Customer', description: null },
    ]);
    const index = new VocabularyIndex(client(get));

    const deletedId = '99999999-9999-9999-9999-999999999999';
    await expect(index.toKey(CONTACT_TYPE_FIELD, deletedId)).resolves.toBe(deletedId);
  });

  it('unknown key lists up to 10 valid keys plus a remainder count and the ls command', async () => {
    const records = Array.from({ length: 15 }, (_, i) => ({
      id: `ct-${i}`,
      key: `type-${i}`,
      name: `Type ${i}`,
      description: null,
    }));
    const get = jest.fn().mockResolvedValue(records);
    const index = new VocabularyIndex(client(get));

    const err = await rejectionOf(index.toId(CONTACT_TYPE_FIELD, 'nonexistent'));
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    for (let i = 0; i < 10; i++) {
      expect(err.message).toContain(`type-${i}`);
    }
    expect(err.message).not.toContain('type-10');
    expect(err.message).toContain('5 more');
    expect(err.message).toContain('cyb contacts type ls');
  });
});

describe('VocabularyIndex — tag resolution (scope-aware)', () => {
  function tagsGet(byScope: Record<string, Array<{ id: string; key: string; scope: string }>>): jest.Mock {
    return jest.fn(async (path: string) => {
      const url = new URL(`http://x${path}`);
      const scope = url.searchParams.get('scope') ?? 'shared';
      const data = byScope[scope] ?? [];
      return { data, total: data.length, page: 1, limit: 100 };
    });
  }

  it('resolves a tag found in the field domain scope', async () => {
    const get = tagsGet({
      contact: [{ id: 'tag-1', key: 'security', scope: 'contact' }],
      shared: [],
    });
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(CONTACT_TAG_FIELD, 'security')).resolves.toBe('tag-1');
  });

  it('falls back to the shared scope when the key is absent from the domain scope', async () => {
    const get = tagsGet({
      contact: [],
      shared: [{ id: 'tag-shared-1', key: 'urgent', scope: 'shared' }],
    });
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(CONTACT_TAG_FIELD, 'urgent')).resolves.toBe('tag-shared-1');
  });

  it('throws an ambiguity error, offering the scope:key form, when a key exists in both scopes', async () => {
    const get = tagsGet({
      contact: [{ id: 'tag-contact-1', key: 'security', scope: 'contact' }],
      shared: [{ id: 'tag-shared-1', key: 'security', scope: 'shared' }],
    });
    const index = new VocabularyIndex(client(get));

    const err = await rejectionOf(index.toId(CONTACT_TAG_FIELD, 'security'));
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    expect(err.message).toContain('contact:security');
    expect(err.message).toContain('shared:security');
  });

  it('an explicit scope:key input bypasses the domain/shared fallback entirely', async () => {
    const get = tagsGet({
      contact: [{ id: 'tag-contact-1', key: 'security', scope: 'contact' }],
      shared: [{ id: 'tag-shared-1', key: 'security', scope: 'shared' }],
    });
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(CONTACT_TAG_FIELD, 'shared:security')).resolves.toBe('tag-shared-1');
    // Only the shared scope should have been queried — never contact.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toContain('scope=shared');
  });

  it('a knowledge-scoped field falls back to shared independently of a contact-scoped field', async () => {
    const get = tagsGet({
      knowledge: [{ id: 'tag-k-1', key: 'draft', scope: 'knowledge' }],
      shared: [{ id: 'tag-shared-1', key: 'urgent', scope: 'shared' }],
    });
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(KNOWLEDGE_TAG_FIELD, 'draft')).resolves.toBe('tag-k-1');
    await expect(index.toId(KNOWLEDGE_TAG_FIELD, 'urgent')).resolves.toBe('tag-shared-1');
  });

  it('unknown tag key names both scopes searched, up to 10 keys, and the tags ls command', async () => {
    const get = tagsGet({ contact: [], shared: [] });
    const index = new VocabularyIndex(client(get));

    const err = await rejectionOf(index.toId(CONTACT_TAG_FIELD, 'nope'));
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('cyb tags ls --scope contact');
  });

  it('two lookups against the same scope cost one request (cached per VocabularyIndex instance)', async () => {
    const get = tagsGet({
      contact: [
        { id: 'tag-1', key: 'security', scope: 'contact' },
        { id: 'tag-2', key: 'billing', scope: 'contact' },
      ],
      shared: [],
    });
    const index = new VocabularyIndex(client(get));

    await index.toId(CONTACT_TAG_FIELD, 'security');
    await index.toId(CONTACT_TAG_FIELD, 'billing');

    const contactCalls = get.mock.calls.filter(([path]: [string]) => path.includes('scope=contact'));
    expect(contactCalls).toHaveLength(1);
  });

  it('toIds/toKeys batch-resolve a list of tag keys/ids', async () => {
    const get = tagsGet({
      contact: [
        { id: 'tag-1', key: 'security', scope: 'contact' },
        { id: 'tag-2', key: 'billing', scope: 'contact' },
      ],
      shared: [],
    });
    const index = new VocabularyIndex(client(get));

    await expect(index.toIds(CONTACT_TAG_FIELD, ['security', 'billing'])).resolves.toEqual([
      'tag-1',
      'tag-2',
    ]);
    await expect(index.toKeys(CONTACT_TAG_FIELD, ['tag-1', 'tag-2'])).resolves.toEqual([
      'security',
      'billing',
    ]);
  });

  it('toKey on a tag id unresolvable in either scope returns the raw id', async () => {
    const get = tagsGet({ contact: [], shared: [] });
    const index = new VocabularyIndex(client(get));

    const missing = '99999999-9999-9999-9999-999999999999';
    await expect(index.toKey(CONTACT_TAG_FIELD, missing)).resolves.toBe(missing);
  });
});

describe('VocabularyIndex — company resolution (name only, never fully indexed)', () => {
  it('resolves a company by an exact name match, narrowed via ?search=', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'co-1', name: 'Acme Corp' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(COMPANY_FIELD, 'Acme Corp')).resolves.toBe('co-1');
    expect(get.mock.calls[0][0]).toBe('/companies?search=Acme%20Corp&page=1&limit=100');
  });

  it('rejects a substring hit that is not an exact name match', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'co-1', name: 'Acme Corporation' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(COMPANY_FIELD, 'Acme')).rejects.toThrow(UsageError);
  });

  it('throws an ambiguity error listing full ids when the name matches more than one company', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [
        { id: '11111111-aaaa-bbbb-cccc-111111111111', name: 'Acme Corp' },
        { id: '22222222-aaaa-bbbb-cccc-222222222222', name: 'Acme Corp' },
      ],
      total: 2,
      page: 1,
      limit: 100,
    });
    const index = new VocabularyIndex(client(get));

    const err = await rejectionOf(index.toId(COMPANY_FIELD, 'Acme Corp'));
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('11111111-aaaa-bbbb-cccc-111111111111');
    expect(err.message).toContain('22222222-aaaa-bbbb-cccc-222222222222');
  });

  it('never issues a request that would fetch every company (no unfiltered /companies call)', async () => {
    const get = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });
    const index = new VocabularyIndex(client(get));

    await expect(index.toId(COMPANY_FIELD, 'Acme Corp')).rejects.toThrow(UsageError);
    for (const [path] of get.mock.calls) {
      expect(path).toContain('search=');
    }
  });

  it('toKey fetches the single company by id', async () => {
    const get = jest.fn().mockResolvedValue({ id: 'co-1', name: 'Acme Corp' });
    const index = new VocabularyIndex(client(get));

    await expect(index.toKey(COMPANY_FIELD, 'co-1')).resolves.toBe('Acme Corp');
    expect(get).toHaveBeenCalledWith('/companies/co-1');
  });

  it('toKey on a company id the API 404s returns the raw id', async () => {
    const get = jest.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'not found'));
    const index = new VocabularyIndex(client(get));

    const missing = '99999999-9999-9999-9999-999999999999';
    await expect(index.toKey(COMPANY_FIELD, missing)).resolves.toBe(missing);
  });

  it('toKey rethrows a non-404 API error rather than masking it as an unresolvable id', async () => {
    const get = jest.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const index = new VocabularyIndex(client(get));

    await expect(index.toKey(COMPANY_FIELD, 'co-1')).rejects.toThrow('boom');
  });
});
