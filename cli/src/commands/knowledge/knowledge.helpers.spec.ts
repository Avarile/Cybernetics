import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import {
  buildKnowledgeDocument,
  buildKnowledgePatch,
  KNOWLEDGE_CREATE_SCHEMA,
  KNOWLEDGE_EDIT_SCHEMA,
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

describe('KNOWLEDGE_EDIT_SCHEMA', () => {
  it('excludes expectedVersion from the frontmatter fields it produces', () => {
    const text = buildKnowledgeDocument(record());
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

describe('buildKnowledgeDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildKnowledgeDocument(record({ title: 'Hello', visibility: 'internal' }));
    expect(text).toContain('title: Hello');
    expect(text).toContain('visibility: internal');
  });

  it('excludes body from the frontmatter and uses it as the document body', () => {
    const text = buildKnowledgeDocument(record({ body: 'Body text here.' }));
    expect(text.split('\n').some((l) => l.trimStart().startsWith('body:'))).toBe(false);
    expect(text.endsWith('Body text here.')).toBe(true);
  });

  it('includes the two header facts the schema cannot express', () => {
    const text = buildKnowledgeDocument(record());
    expect(text).toContain('YYYY-MM-DD');
    expect(text).toContain('becomes the record body');
  });

  it('renders a null body as an empty document body', () => {
    const text = buildKnowledgeDocument(record({ body: null }));
    expect(text.endsWith('\n\n') || text.endsWith('---\n\n')).toBe(true);
  });
});

describe('buildKnowledgePatch', () => {
  it('is empty when the document round-trips with no edits', () => {
    const rec = record();
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec));
    expect(buildKnowledgePatch(rec, doc)).toEqual({});
  });

  it('includes only the field that changed', () => {
    const rec = record({ title: 'Old Title' });
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec));
    doc.fields.title = 'New Title';

    expect(buildKnowledgePatch(rec, doc)).toEqual({ title: 'New Title' });
  });

  it('includes body when only the body changed', () => {
    const rec = record({ body: 'old body' });
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec));
    doc.body = 'new body';

    expect(buildKnowledgePatch(rec, doc)).toEqual({ body: 'new body' });
  });

  it('does not flag a date-time field as changed when it round-trips through YYYY-MM-DD', () => {
    const rec = record({ reviewDueAt: '2024-03-15T00:00:00.000Z' });
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec));

    expect(buildKnowledgePatch(rec, doc)).toEqual({});
  });

  it('flags a changed date-time field using the buffer’s edited value', () => {
    const rec = record({ reviewDueAt: '2024-03-15T00:00:00.000Z' });
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec));
    doc.fields.reviewDueAt = '2025-01-01';

    expect(buildKnowledgePatch(rec, doc)).toEqual({ reviewDueAt: '2025-01-01' });
  });

  it('sends null when the user clears a field that had a value', () => {
    const rec = record({ summary: 'has a summary' });
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec));
    delete doc.fields.summary;

    expect(buildKnowledgePatch(rec, doc)).toEqual({ summary: null });
  });

  it('never includes expectedVersion — that is the caller’s job, not the diff’s', () => {
    const rec = record();
    const doc: EditorDocument = parseBack(buildKnowledgeDocument(rec));
    doc.fields.title = 'Changed';

    expect(buildKnowledgePatch(rec, doc)).not.toHaveProperty('expectedVersion');
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

function rowStub(): KnowledgeRecord {
  return record();
}

// Local re-parse helper: buildKnowledgeDocument's output round-trips through
// the real frontmatter parser, exercised here rather than re-implemented.
function parseBack(text: string): EditorDocument {
  return parseDocument(text);
}
