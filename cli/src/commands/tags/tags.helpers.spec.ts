import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import {
  buildTagDocument,
  buildTagPatch,
  morePagesNote,
  TAGS_CREATE_SCHEMA,
  TAGS_EDIT_SCHEMA,
  type TagRecord,
} from './tags.helpers';

function record(overrides: Partial<TagRecord> = {}): TagRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    key: 'security',
    label: 'Security',
    scope: 'contact',
    color: null,
    description: null,
    usageCount: 0,
    isSystem: false,
    ...overrides,
  };
}

describe('TAGS_EDIT_SCHEMA', () => {
  it('carries label/color/description but not key or scope — neither is changeable after creation', () => {
    const props = (TAGS_EDIT_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['label', 'color', 'description']));
    expect(Object.keys(props)).not.toContain('key');
    expect(Object.keys(props)).not.toContain('scope');
  });
});

describe('TAGS_CREATE_SCHEMA', () => {
  it('requires key and label', () => {
    const schema = TAGS_CREATE_SCHEMA as { required?: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['key', 'label']));
  });
});

describe('buildTagDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildTagDocument(record({ label: 'Hello', color: '#fff' }));
    expect(text).toContain('label: Hello');
    expect(text).toContain('color: "#fff"');
  });

  it('renders the header note that key/scope cannot be changed', () => {
    const text = buildTagDocument(record());
    expect(text).toContain('cannot be changed');
  });
});

describe('buildTagPatch', () => {
  it('is empty when the document round-trips with no edits', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildTagDocument(rec));
    expect(buildTagPatch(rec, doc)).toEqual({});
  });

  it('includes only the field that changed', () => {
    const rec = record({ label: 'Old' });
    const doc: EditorDocument = parseDocument(buildTagDocument(rec));
    doc.fields.label = 'New';

    expect(buildTagPatch(rec, doc)).toEqual({ label: 'New' });
  });

  it('sends null when the user clears a field that had a value', () => {
    const rec = record({ description: 'was set' });
    const doc: EditorDocument = parseDocument(buildTagDocument(rec));
    delete doc.fields.description;

    expect(buildTagPatch(rec, doc)).toEqual({ description: null });
  });
});

describe('morePagesNote', () => {
  it('is null when every matching row fit on this page', () => {
    expect(morePagesNote({ data: [{}, {}], total: 2, page: 1, limit: 20 })).toBeNull();
  });

  it('reports how many rows exist beyond this page', () => {
    const note = morePagesNote({ data: [{}], total: 3, page: 1, limit: 1 });
    expect(note).toContain('2');
  });
});
