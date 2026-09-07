import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import { UsageError } from '../../core/errors';
import { KEY_BACKED_FIELDS, type KeyBackedField, type VocabularyIndex } from '../../core/resolve/vocabulary';
import {
  buildKnowledgeDocument,
  buildKnowledgePatch,
  KNOWLEDGE_CREATE_SCHEMA,
  KNOWLEDGE_EDIT_SCHEMA,
  resolveKnowledgeKeyBacked,
  withheldRowsNote,
  type KnowledgeListEnvelope,
  type KnowledgeRecord,
} from './knowledge.helpers';

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    title: 'Existing Title',
    slug: 'existing-title',
    summary: 'A summary.',
    body: 'The body.',
    format: 'markdown',
    status: 'draft',
    visibility: 'private',
    version: 3,
    typeId: null,
    categoryId: null,
    ownerUserId: null,
    sourceUrl: null,
    sourceFileId: null,
    language: 'en',
    publishedAt: null,
    reviewDueAt: null,
    tagIds: [],
    access: 'manage',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

// A stub VocabularyIndex, standing in for Task 1's real (HTTP-backed) one --
// see contacts.helpers.spec.ts for the mirrored fixture. Knowledge has no
// `company` field, so there's no COMPANY_ID entry here.
const TYPE_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
const OTHER_TYPE_ID = 'bbbbbbbb-2222-2222-2222-222222222222';
const CATEGORY_ID = 'cccccccc-1111-1111-1111-111111111111';
const TAG_ID_1 = 'eeeeeeee-1111-1111-1111-111111111111';
const TAG_ID_2 = 'eeeeeeee-2222-2222-2222-222222222222';

function fakeVocab(): VocabularyIndex {
  const idToKey: Record<string, string> = {
    [TYPE_ID]: 'howto',
    [OTHER_TYPE_ID]: 'reference',
    [CATEGORY_ID]: 'internal-only',
    [TAG_ID_1]: 'security',
    [TAG_ID_2]: 'urgent',
  };
  const keyToId = Object.fromEntries(Object.entries(idToKey).map(([id, key]) => [key, id]));

  return {
    toKey: jest.fn(async (_field: KeyBackedField, id: string) => idToKey[id] ?? id),
    toKeys: jest.fn(async (_field: KeyBackedField, ids: string[]) => ids.map((id) => idToKey[id] ?? id)),
    toId: jest.fn(async (field: KeyBackedField, value: string) => {
      if (value === 'bogus') {
        throw new UsageError(`Unknown ${field.kind} key "bogus". Valid keys: howto, internal-only. See: cyb knowledge type ls`);
      }
      return keyToId[value] ?? value;
    }),
    toIds: jest.fn(async (_field: KeyBackedField, values: string[]) =>
      Promise.all(values.map((v) => (v === 'bogus' ? Promise.reject(new UsageError('bad tag')) : keyToId[v] ?? v))),
    ),
  } as unknown as VocabularyIndex;
}

describe('KNOWLEDGE_EDIT_SCHEMA', () => {
  it('excludes expectedVersion from the frontmatter fields it produces', async () => {
    const rec = record();
    const vocab = fakeVocab();
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const text = buildKnowledgeDocument(rec, keyBacked);
    expect(text).not.toContain('expectedVersion');
  });

  it('still carries every other UpdateKnowledgeDto field', () => {
    const props = (KNOWLEDGE_EDIT_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['title', 'summary', 'visibility', 'tagIds']));
    expect(Object.keys(props)).not.toContain('expectedVersion');
  });
});

describe('KNOWLEDGE_CREATE_SCHEMA', () => {
  it('is CreateKnowledgeDto, unmodified', () => {
    const props = (KNOWLEDGE_CREATE_SCHEMA as { required?: string[] }).required ?? [];
    expect(props).toEqual(['title']);
  });
});

describe('resolveKnowledgeKeyBacked', () => {
  it('resolves type/category/tags to keys via the vocab -- no company field', async () => {
    const vocab = fakeVocab();
    const rec = record({ typeId: TYPE_ID, categoryId: CATEGORY_ID, tagIds: [TAG_ID_1, TAG_ID_2] });

    const resolved = await resolveKnowledgeKeyBacked(rec, vocab);

    expect(resolved).toEqual({ type: 'howto', category: 'internal-only', tags: ['security', 'urgent'] });
    expect(resolved).not.toHaveProperty('company');
  });

  it('resolves to null/[] for unset fields without calling the vocab', async () => {
    const vocab = fakeVocab();
    const resolved = await resolveKnowledgeKeyBacked(record(), vocab);

    expect(resolved).toEqual({ type: null, category: null, tags: [] });
    expect(vocab.toKey).not.toHaveBeenCalled();
    expect(vocab.toKeys).not.toHaveBeenCalled();
  });
});

describe('buildKnowledgeDocument', () => {
  it('renders the record fields uncommented, populated from the record', async () => {
    const vocab = fakeVocab();
    const rec = record({ title: 'Hello', visibility: 'internal' });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const text = buildKnowledgeDocument(rec, keyBacked);
    expect(text).toContain('title: Hello');
    expect(text).toContain('visibility: internal');
  });

  it('excludes body from the frontmatter and uses it as the document body', async () => {
    const vocab = fakeVocab();
    const rec = record({ body: 'Body text here.' });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const text = buildKnowledgeDocument(rec, keyBacked);
    expect(text.split('\n').some((l) => l.trimStart().startsWith('body:'))).toBe(false);
    expect(text.endsWith('Body text here.')).toBe(true);
  });

  it('includes the two header facts the schema cannot express', async () => {
    const vocab = fakeVocab();
    const rec = record();
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const text = buildKnowledgeDocument(rec, keyBacked);
    expect(text).toContain('YYYY-MM-DD');
    expect(text).toContain('becomes the record body');
  });

  it('renders a null body as an empty document body', async () => {
    const vocab = fakeVocab();
    const rec = record({ body: null });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const text = buildKnowledgeDocument(rec, keyBacked);
    expect(text.endsWith('\n\n') || text.endsWith('---\n\n')).toBe(true);
  });

  it('renders a resolved key-backed value under its buffer name, never the raw dtoField, and has no company field', async () => {
    const vocab = fakeVocab();
    const rec = record({ typeId: TYPE_ID, tagIds: [TAG_ID_1] });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);

    const text = buildKnowledgeDocument(rec, keyBacked);

    expect(text).toContain('type: howto');
    expect(text).toContain('tags: [ security ]');
    expect(text.split('\n').some((l) => l.startsWith('typeId:'))).toBe(false);
    expect(text.split('\n').some((l) => l.trimStart().startsWith('company'))).toBe(false);
  });
});

describe('buildKnowledgePatch', () => {
  it('is empty when the document round-trips with no edits', async () => {
    const vocab = fakeVocab();
    const rec = record();
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
    expect(await buildKnowledgePatch(rec, doc, keyBacked, vocab)).toEqual({});
  });

  it('includes only the field that changed', async () => {
    const vocab = fakeVocab();
    const rec = record({ title: 'Old Title' });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
    doc.fields.title = 'New Title';

    expect(await buildKnowledgePatch(rec, doc, keyBacked, vocab)).toEqual({ title: 'New Title' });
  });

  it('includes body when only the body changed', async () => {
    const vocab = fakeVocab();
    const rec = record({ body: 'old body' });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
    doc.body = 'new body';

    expect(await buildKnowledgePatch(rec, doc, keyBacked, vocab)).toEqual({ body: 'new body' });
  });

  it('does not flag a date-time field as changed when it round-trips through YYYY-MM-DD', async () => {
    const vocab = fakeVocab();
    const rec = record({ reviewDueAt: '2024-03-15T00:00:00.000Z' });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));

    expect(await buildKnowledgePatch(rec, doc, keyBacked, vocab)).toEqual({});
  });

  it('flags a changed date-time field using the buffer’s edited value', async () => {
    const vocab = fakeVocab();
    const rec = record({ reviewDueAt: '2024-03-15T00:00:00.000Z' });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
    doc.fields.reviewDueAt = '2025-01-01';

    expect(await buildKnowledgePatch(rec, doc, keyBacked, vocab)).toEqual({ reviewDueAt: '2025-01-01' });
  });

  it('sends null when the user clears a field that had a value', async () => {
    const vocab = fakeVocab();
    const rec = record({ summary: 'has a summary' });
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
    delete doc.fields.summary;

    expect(await buildKnowledgePatch(rec, doc, keyBacked, vocab)).toEqual({ summary: null });
  });

  it('never includes expectedVersion — that is the caller’s job, not the diff’s', async () => {
    const vocab = fakeVocab();
    const rec = record();
    const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
    doc.fields.title = 'Changed';

    expect(await buildKnowledgePatch(rec, doc, keyBacked, vocab)).not.toHaveProperty('expectedVersion');
  });

  describe('key-backed fields', () => {
    it('does not appear in the patch, and never calls the vocab, when unchanged', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID, tagIds: [TAG_ID_1] });
      const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
      (vocab.toId as jest.Mock).mockClear();
      (vocab.toIds as jest.Mock).mockClear();
      const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));

      const patch = await buildKnowledgePatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({});
      expect(vocab.toId).not.toHaveBeenCalled();
      expect(vocab.toIds).not.toHaveBeenCalled();
    });

    it('resolves a changed scalar key to its dtoField id', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID });
      const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
      const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
      doc.fields.type = 'reference';

      const patch = await buildKnowledgePatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({ typeId: OTHER_TYPE_ID });
    });

    it('resolves multiple changed tag keys to ids', async () => {
      const vocab = fakeVocab();
      const rec = record({ tagIds: [TAG_ID_1] });
      const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
      const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
      doc.fields.tags = ['security', 'urgent'];

      const patch = await buildKnowledgePatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({ tagIds: [TAG_ID_1, TAG_ID_2] });
    });

    it('a raw UUID in a key-backed field passes through unchanged', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID });
      const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
      const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
      const otherUuid = 'ffffffff-1111-1111-1111-111111111111';
      doc.fields.type = otherUuid;

      const patch = await buildKnowledgePatch(rec, doc, keyBacked, vocab);

      expect(patch).toEqual({ typeId: otherUuid });
    });

    it('an unknown key rejects with an ApiError naming the buffer field, not a bare UsageError', async () => {
      const vocab = fakeVocab();
      const rec = record({ typeId: TYPE_ID });
      const keyBacked = await resolveKnowledgeKeyBacked(rec, vocab);
      const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec, keyBacked));
      doc.fields.type = 'bogus';

      const err = await buildKnowledgePatch(rec, doc, keyBacked, vocab).catch((e) => e);

      expect(err.name).toBe('ApiError');
      expect(err.issues).toEqual([{ path: ['type'], message: expect.stringContaining('bogus') }]);
    });
  });
});

describe('withheldRowsNote', () => {
  function envelope(overrides: Partial<KnowledgeListEnvelope> = {}): KnowledgeListEnvelope {
    return { data: [], total: 0, page: 1, limit: 20, ...overrides };
  }

  it('is null when totalBeforeAccess is absent', () => {
    expect(withheldRowsNote(envelope({ data: [rowStub()] }))).toBeNull();
  });

  it('is null when every matching row on this page was visible', () => {
    expect(
      withheldRowsNote(envelope({ data: [rowStub(), rowStub()], totalBeforeAccess: 2 })),
    ).toBeNull();
  });

  it('reports how many rows were withheld on this page', () => {
    const note = withheldRowsNote(
      envelope({ data: [rowStub()], totalBeforeAccess: 3, page: 1, limit: 20 }),
    );
    expect(note).toContain('2');
  });

  it('accounts for the current page offset', () => {
    // page 2, limit 20: rows 21-40 expected. totalBeforeAccess 25 means only
    // 5 exist on this page; 3 withheld means only 2 came back.
    const note = withheldRowsNote(
      envelope({ data: [rowStub(), rowStub()], totalBeforeAccess: 25, page: 2, limit: 20 }),
    );
    expect(note).toContain('3');
  });
});

describe('KEY_BACKED_FIELDS.knowledge', () => {
  it('has no company entry -- knowledge DTOs carry no companyId', () => {
    expect(KEY_BACKED_FIELDS.knowledge.find((f) => f.bufferField === 'company')).toBeUndefined();
    expect(KEY_BACKED_FIELDS.knowledge.map((f) => f.bufferField).sort()).toEqual(
      ['type', 'category', 'tags'].sort(),
    );
  });
});

function rowStub(): KnowledgeRecord {
  return record();
}

// Local re-parse helper: buildKnowledgeDocument's output round-trips through
// the real frontmatter parser, exercised here rather than re-implemented.
function parseBack(text: string): EditorDocument {
  return parseDocument(text);
}
