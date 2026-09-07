import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import {
  buildCompanyDocument,
  buildCompanyPatch,
  COMPANIES_CREATE_SCHEMA,
  COMPANIES_EDIT_SCHEMA,
  morePagesNote,
  type CompanyRecord,
} from './companies.helpers';

function record(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Acme Corp',
    legalName: null,
    domain: 'acme.example',
    industry: null,
    size: null,
    website: null,
    phone: null,
    country: null,
    parentCompanyId: null,
    ownerUserId: null,
    status: 'active',
    description: null,
    taxNumber: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('COMPANIES_EDIT_SCHEMA', () => {
  it('carries every UpdateCompanyDto field', () => {
    const props = (COMPANIES_EDIT_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['name', 'domain', 'status', 'taxNumber']));
  });
});

describe('COMPANIES_CREATE_SCHEMA', () => {
  it('requires only name', () => {
    const schema = COMPANIES_CREATE_SCHEMA as { required?: string[] };
    expect(schema.required).toEqual(['name']);
  });
});

describe('buildCompanyDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildCompanyDocument(record({ name: 'Hello Inc', domain: 'hello.example' }));
    expect(text).toContain('name: Hello Inc');
    expect(text).toContain('domain: hello.example');
  });
});

describe('buildCompanyPatch', () => {
  it('is empty when the document round-trips with no edits', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildCompanyDocument(rec));
    expect(buildCompanyPatch(rec, doc)).toEqual({});
  });

  it('includes only the field that changed', () => {
    const rec = record({ name: 'Old' });
    const doc: EditorDocument = parseDocument(buildCompanyDocument(rec));
    doc.fields.name = 'New';

    expect(buildCompanyPatch(rec, doc)).toEqual({ name: 'New' });
  });

  it('sends null when the user clears a field that had a value', () => {
    const rec = record({ industry: 'Software' });
    const doc: EditorDocument = parseDocument(buildCompanyDocument(rec));
    delete doc.fields.industry;

    expect(buildCompanyPatch(rec, doc)).toEqual({ industry: null });
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
