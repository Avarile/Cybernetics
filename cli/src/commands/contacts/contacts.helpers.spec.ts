import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import { UsageError } from '../../core/errors';
import { KEY_BACKED_FIELDS, type KeyBackedField, type VocabularyIndex } from '../../core/resolve/vocabulary';
import {
  buildContactDocument,
  buildContactPatch,
  CONTACTS_CREATE_SCHEMA,
  CONTACTS_EDIT_SCHEMA,
  morePagesNote,
  resolveContactKeyBacked,
  type ContactRecord,
} from './contacts.helpers';

function record(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    displayName: 'Ada Lovelace',
    firstName: 'Ada',
    lastName: 'Lovelace',
    primaryEmail: 'ada@example.com',
    primaryPhone: null,
    jobTitle: null,
    companyId: null,
    typeId: null,
    categoryId: null,
    ownerUserId: null,
    status: 'active',
    source: 'manual',
    visibility: 'private',
    country: null,
    lastContactedAt: null,
    nextFollowUpAt: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

// A stub VocabularyIndex, standing in for Task 1's real (HTTP-backed) one:
// a small fixed id<->key dictionary per kind, plus a "bogus" key that always
// misses, so tests can drive the unknown-key path without a real ApiClient.
const TYPE_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
const OTHER_TYPE_ID = 'bbbbbbbb-2222-2222-2222-222222222222';
const CATEGORY_ID = 'cccccccc-1111-1111-1111-111111111111';
const COMPANY_ID = 'dddddddd-1111-1111-1111-111111111111';
const TAG_ID_1 = 'eeeeeeee-1111-1111-1111-111111111111';
const TAG_ID_2 = 'eeeeeeee-2222-2222-2222-222222222222';

function fakeVocab(): VocabularyIndex {
  const idToKey: Record<string, string> = {
    [TYPE_ID]: 'customer',
    [OTHER_TYPE_ID]: 'enterprise',
    [CATEGORY_ID]: 'vip',
    [COMPANY_ID]: 'Acme',
    [TAG_ID_1]: 'security',
    [TAG_ID_2]: 'urgent',
  };
  const keyToId = Object.fromEntries(Object.entries(idToKey).map(([id, key]) => [key, id]));

  return {
    toKey: jest.fn(async (_field: KeyBackedField, id: string) => idToKey[id] ?? id),
    toKeys: jest.fn(async (_field: KeyBackedField, ids: string[]) => ids.map((id) => idToKey[id] ?? id)),
    toId: jest.fn(async (field: KeyBackedField, value: string) => {
      if (value === 'bogus') {
        throw new UsageError(`Unknown ${field.kind} key "bogus". Valid keys: customer, vip. See: cyb contacts type ls`);
      }
      return keyToId[value] ?? value;
    }),
    toIds: jest.fn(async (field: KeyBackedField, values: string[]) =>
      Promise.all(values.map((v) => (v === 'bogus' ? Promise.reject(new UsageError('bad tag')) : keyToId[v] ?? v))),
    ),
  } as unknown as VocabularyIndex;
}

describe('CONTACTS_EDIT_SCHEMA', () => {
  it('carries every UpdateContactDto field, unmodified — there is no expectedVersion to strip', () => {
    const props = (CONTACTS_EDIT_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['displayName', 'primaryEmail', 'status', 'tagIds', 'notes']),
    );
    expect(Object.keys(props)).not.toContain('expectedVersion');
  });
});

describe('CONTACTS_CREATE_SCHEMA', () => {
  it('is CreateContactDto, unmodified, with no required array — the name-or-email rule is cross-field', () => {
    const schema = CONTACTS_CREATE_SCHEMA as { required?: string[] };
    expect(schema.required ?? []).toEqual([]);
  });
});

describe('resolveContactKeyBacked', () => {
  it('resolves type/category/company/tags to keys via the vocab', async () => {
    const vocab = fakeVocab();
    const rec = record({ typeId: TYPE_ID, categoryId: CATEGORY_ID, companyId: COMPANY_ID, tagIds: [TAG_ID_1, TAG_ID_2] });

    const resolved = await resolveContactKeyBacked(rec, vocab);

    expect(resolved).toEqual({ type: 'customer', category: 'vip', company: 'Acme', tags: ['security', 'urgent'] });
  });

  it('resolves to null/[] for unset fields without calling the vocab', async () => {
    const vocab = fakeVocab();
    const rec = record();

    const resolved = await resolveContactKeyBacked(rec, vocab);

    expect(resolved).toEqual({ type: null, category: null, company: null, tags: [] });
    expect(vocab.toKey).not.toHaveBeenCalled();
    expect(vocab.toKeys).not.toHaveBeenCalled();
  });
});

describe('buildContactDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildContactDocument(record({ displayName: 'Hello', status: 'inactive' }), {});
    expect(text).toContain('displayName: Hello');
    expect(text).toContain('status: inactive');
  });

  it('excludes notes from the frontmatter and uses it as the document body', () => {
    const text = buildContactDocument(record(), {});
    expect(text.split('\n').some((l) => l.trimStart().startsWith('notes:'))).toBe(false);
  });

  it('renders notes as an empty body — GET never returns it, so a fetched record has nothing to show', () => {
    const text = buildContactDocument(record(), {});
    expect(text.endsWith('\n\n') || text.endsWith('---\n\n')).toBe(true);
  });

  it('renders the header facts about the gap fields and about notes becoming the body', () => {
    const text = buildContactDocument(record(), {});
    expect(text).toContain('YYYY-MM-DD');
    expect(text).toContain('never');
    expect(text).toContain("becomes the contact's notes");
  });

  it('renders salutation, address, timezone, language and birthday as blank — never returned by GET', () => {
    const text = buildContactDocument(record(), {});
    for (const field of ['salutation', 'timezone', 'language', 'birthday']) {
      const line = text.split('\n').find((l) => l.startsWith(`${field}:`));
      // No value between the colon and an optional trailing `# facts` comment.
      expect(line).toMatch(new RegExp(`^${field}:\\s*(#.*)?$`));
    }
  });

  it('renders a resolved key-backed value under its buffer name, never the raw dtoField', async () => {
    const vocab = fakeVocab();
    const rec = record({ typeId: TYPE_ID, tagIds: [TAG_ID_1] });
    const keyBacked = await resolveContactKeyBacked(rec, vocab);

    const text = buildContactDocument(rec, keyBacked);

    expect(text).toContain('type: customer');
    expect(text).toContain('tags: [ security ]');
    expect(text.split('\n').some((l) => l.startsWith('typeId:'))).toBe(false);
  });
});

describe('buildContactPatch', () => {
  it('is empty when the document round-trips with no edits', async () => {
    const vocab = fakeVocab();
    const rec = record();
    const keyBacked = await resolveContactKeyBacked(rec, vocab);
    const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));

    expect(await buildContactPatch(rec, doc, keyBacked, vocab)).toEqual({});
  });

  it('includes only the field that changed', async () => {
    const vocab = fakeVocab();
    const rec = record({ displayName: 'Old Name' });
    const keyBacked = await resolveContactKeyBacked(rec, vocab);
    const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
    doc.fields.displayName = 'New Name';

    expect(await buildContactPatch(rec, doc, keyBacked, vocab)).toEqual({ displayName: 'New Name' });
  });

  it('includes notes when the user types something into the body', async () => {
    const vocab = fakeVocab();
    const rec = record();
    const keyBacked = await resolveContactKeyBacked(rec, vocab);
    const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
    doc.body = 'Met at the conference.';

    expect(await buildContactPatch(rec, doc, keyBacked, vocab)).toEqual({ notes: 'Met at the conference.' });
  });

  it('does not send notes when the body is left blank — it never had an observable value to compare against', async () => {
    const vocab = fakeVocab();
    const rec = record();
    const keyBacked = await resolveContactKeyBacked(rec, vocab);
    const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));

    expect(await buildContactPatch(rec, doc, keyBacked, vocab)).toEqual({});
  });

  it('sends null when the user clears a field that had a value', async () => {
    const vocab = fakeVocab();
    const rec = record({ primaryPhone: '+1 555 0100' });
    const keyBacked = await resolveContactKeyBacked(rec, vocab);
    const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
    delete doc.fields.primaryPhone;

    expect(await buildContactPatch(rec, doc, keyBacked, vocab)).toEqual({ primaryPhone: null });
  });

  it('includes a gap field (e.g. salutation) when the user fills it in, even though it started blank', async () => {
    const vocab = fakeVocab();
    const rec = record();
    const keyBacked = await resolveContactKeyBacked(rec, vocab);
    const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
    doc.fields.salutation = 'Dr.';

    expect(await buildContactPatch(rec, doc, keyBacked, vocab)).toEqual({ salutation: 'Dr.' });
  });

  describe('key-backed fields', () => {
    it('does not appear in the patch, and never calls the vocab, when unchanged', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID, tagIds: [TAG_ID_1] });
      const keyBacked = await resolveContactKeyBacked(rec, vocab);
      (vocab.toId as jest.Mock).mockClear();
      (vocab.toIds as jest.Mock).mockClear();
      const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));

      const patch = await buildContactPatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({});
      expect(vocab.toId).not.toHaveBeenCalled();
      expect(vocab.toIds).not.toHaveBeenCalled();
    });

    it('resolves a changed scalar key to its dtoField id', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID });
      const keyBacked = await resolveContactKeyBacked(rec, vocab);
      const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
      doc.fields.type = 'enterprise'; // buffer text changed to a different type key

      const patch = await buildContactPatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({ typeId: OTHER_TYPE_ID });
    });

    it('resolves multiple changed tag keys to ids', async () => {
      const vocab = fakeVocab();
      const rec = record({ tagIds: [TAG_ID_1] });
      const keyBacked = await resolveContactKeyBacked(rec, vocab);
      const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
      doc.fields.tags = ['security', 'urgent'];

      const patch = await buildContactPatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({ tagIds: [TAG_ID_1, TAG_ID_2] });
    });

    it('sends null when a key-backed field is cleared', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID });
      const keyBacked = await resolveContactKeyBacked(rec, vocab);
      const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
      delete doc.fields.type;

      const patch = await buildContactPatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({ typeId: null });
    });

    it('a raw UUID in a key-backed field passes through unchanged', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID });
      const keyBacked = await resolveContactKeyBacked(rec, vocab);
      const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
      const otherUuid = 'ffffffff-1111-1111-1111-111111111111';
      doc.fields.type = otherUuid;

      const patch = await buildContactPatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({ typeId: otherUuid });
    });

    it('an unknown key rejects with an ApiError naming the buffer field, not a bare UsageError', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID });
      const keyBacked = await resolveContactKeyBacked(rec, vocab);
      const doc: EditorDocument = parseDocument(buildContactDocument(rec, keyBacked));
      doc.fields.type = 'bogus';

      const err = await buildContactPatch(rec, doc, keyBacked, vocab).catch((e) => e);

      expect(err.name).toBe('ApiError');
      expect(err.issues).toEqual([{ path: ['type'], message: expect.stringContaining('bogus') }]);
    });
  });
});

describe('morePagesNote', () => {
  it('is null when every matching row fit on this page', () => {
    expect(morePagesNote({ data: [{}, {}], total: 2, page: 1, limit: 20 })).toBeNull();
  });

  it('reports how many rows exist beyond this page', () => {
    const note = morePagesNote({ data: [{}], total: 3, page: 1, limit: 1 });
    expect(note).toContain('2');
    expect(note).toContain('--page 2');
  });

  it('accounts for the current page offset', () => {
    // page 2, limit 20, total 45: rows 1-20 already behind us, this page has
    // 20 more (21-40), 5 remain (41-45).
    const note = morePagesNote({ data: new Array(20).fill({}), total: 45, page: 2, limit: 20 });
    expect(note).toContain('5');
  });
});

describe('KEY_BACKED_FIELDS.contact', () => {
  it('is what contacts.helpers.ts wires into buildContactDocument/buildContactPatch', () => {
    expect(KEY_BACKED_FIELDS.contact.map((f) => f.bufferField).sort()).toEqual(
      ['type', 'category', 'tags', 'company'].sort(),
    );
  });
});
