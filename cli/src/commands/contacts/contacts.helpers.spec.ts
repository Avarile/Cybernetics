import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import {
  buildContactDocument,
  buildContactPatch,
  CONTACTS_CREATE_SCHEMA,
  CONTACTS_EDIT_SCHEMA,
  morePagesNote,
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

describe('buildContactDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildContactDocument(record({ displayName: 'Hello', status: 'inactive' }));
    expect(text).toContain('displayName: Hello');
    expect(text).toContain('status: inactive');
  });

  it('excludes notes from the frontmatter and uses it as the document body', () => {
    const text = buildContactDocument(record());
    expect(text.split('\n').some((l) => l.trimStart().startsWith('notes:'))).toBe(false);
  });

  it('renders notes as an empty body — GET never returns it, so a fetched record has nothing to show', () => {
    const text = buildContactDocument(record());
    expect(text.endsWith('\n\n') || text.endsWith('---\n\n')).toBe(true);
  });

  it('renders the header facts about the gap fields and about notes becoming the body', () => {
    const text = buildContactDocument(record());
    expect(text).toContain('YYYY-MM-DD');
    expect(text).toContain('never');
    expect(text).toContain("becomes the contact's notes");
  });

  it('renders salutation, address, timezone, language and birthday as blank — never returned by GET', () => {
    const text = buildContactDocument(record());
    for (const field of ['salutation', 'timezone', 'language', 'birthday']) {
      const line = text.split('\n').find((l) => l.startsWith(`${field}:`));
      // No value between the colon and an optional trailing `# facts` comment.
      expect(line).toMatch(new RegExp(`^${field}:\\s*(#.*)?$`));
    }
  });
});

describe('buildContactPatch', () => {
  it('is empty when the document round-trips with no edits', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildContactDocument(rec));
    expect(buildContactPatch(rec, doc)).toEqual({});
  });

  it('includes only the field that changed', () => {
    const rec = record({ displayName: 'Old Name' });
    const doc: EditorDocument = parseDocument(buildContactDocument(rec));
    doc.fields.displayName = 'New Name';

    expect(buildContactPatch(rec, doc)).toEqual({ displayName: 'New Name' });
  });

  it('includes notes when the user types something into the body', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildContactDocument(rec));
    doc.body = 'Met at the conference.';

    expect(buildContactPatch(rec, doc)).toEqual({ notes: 'Met at the conference.' });
  });

  it('does not send notes when the body is left blank — it never had an observable value to compare against', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildContactDocument(rec));

    expect(buildContactPatch(rec, doc)).toEqual({});
  });

  it('sends null when the user clears a field that had a value', () => {
    const rec = record({ primaryPhone: '+1 555 0100' });
    const doc: EditorDocument = parseDocument(buildContactDocument(rec));
    delete doc.fields.primaryPhone;

    expect(buildContactPatch(rec, doc)).toEqual({ primaryPhone: null });
  });

  it('includes a gap field (e.g. salutation) when the user fills it in, even though it started blank', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildContactDocument(rec));
    doc.fields.salutation = 'Dr.';

    expect(buildContactPatch(rec, doc)).toEqual({ salutation: 'Dr.' });
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
