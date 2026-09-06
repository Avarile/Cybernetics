import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import {
  buildMilestoneDocument,
  buildMilestonePatch,
  buildProjectDocument,
  buildProjectPatch,
  PROJECTS_CREATE_SCHEMA,
  PROJECTS_EDIT_SCHEMA,
  morePagesNote,
  type MilestoneRecord,
  type ProjectRecord,
} from './projects.helpers';

function milestone(overrides: Partial<MilestoneRecord> = {}): MilestoneRecord {
  return {
    id: 'cccccccc-3333-3333-3333-333333333333',
    projectId: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Beta',
    description: null,
    status: 'planned',
    dueDate: null,
    reachedAt: null,
    ownerUserId: null,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

function record(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    key: 'CYB',
    name: 'Cybernetics',
    description: null,
    status: 'active',
    priority: 'medium',
    visibility: 'private',
    ownerUserId: null,
    leadUserId: null,
    startDate: null,
    dueDate: null,
    progressPct: 0,
    tagIds: [],
    access: 'owner',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PROJECTS_EDIT_SCHEMA', () => {
  it('carries every UpdateProjectDto field, unmodified — there is no expectedVersion to strip', () => {
    const props = (PROJECTS_EDIT_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['name', 'status', 'priority', 'tagIds', 'description']),
    );
    expect(Object.keys(props)).not.toContain('expectedVersion');
  });
});

describe('PROJECTS_CREATE_SCHEMA', () => {
  it('is CreateProjectDto, unmodified, with key and name required', () => {
    const schema = PROJECTS_CREATE_SCHEMA as { required?: string[] };
    expect(schema.required).toEqual(['key', 'name']);
  });
});

describe('buildProjectDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildProjectDocument(record({ name: 'Hello', status: 'on_hold' }));
    expect(text).toContain('name: Hello');
    expect(text).toContain('status: on_hold');
  });

  it('excludes description from the frontmatter and uses it as the document body', () => {
    const text = buildProjectDocument(record({ description: 'Some notes' }));
    expect(text.split('\n').some((l) => l.trimStart().startsWith('description:'))).toBe(false);
    expect(text.endsWith('Some notes')).toBe(true);
  });

  it('renders the header facts about the gap fields and about description becoming the body', () => {
    const text = buildProjectDocument(record());
    expect(text).toContain('YYYY-MM-DD');
    expect(text).toContain('never returned');
    expect(text).toContain("becomes the project's description");
  });

  it('renders parentProjectId, budgetAmount, currency and color as blank — never returned by GET', () => {
    const text = buildProjectDocument(record());
    for (const field of ['parentProjectId', 'budgetAmount', 'currency', 'color']) {
      const line = text.split('\n').find((l) => l.startsWith(`${field}:`));
      expect(line).toMatch(new RegExp(`^${field}:\\s*(#.*)?$`));
    }
  });
});

describe('buildProjectPatch', () => {
  it('is empty when the document round-trips with no edits', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildProjectDocument(rec));
    expect(buildProjectPatch(rec, doc)).toEqual({});
  });

  it('includes only the field that changed', () => {
    const rec = record({ name: 'Old Name' });
    const doc: EditorDocument = parseDocument(buildProjectDocument(rec));
    doc.fields.name = 'New Name';

    expect(buildProjectPatch(rec, doc)).toEqual({ name: 'New Name' });
  });

  it('includes description when the user types something into the body', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildProjectDocument(rec));
    doc.body = 'A new mission statement.';

    expect(buildProjectPatch(rec, doc)).toEqual({ description: 'A new mission statement.' });
  });

  it('sends null when the user clears a field that had a value', () => {
    const rec = record({ leadUserId: 'bbbbbbbb-2222-2222-2222-222222222222' });
    const doc: EditorDocument = parseDocument(buildProjectDocument(rec));
    delete doc.fields.leadUserId;

    expect(buildProjectPatch(rec, doc)).toEqual({ leadUserId: null });
  });

  it('includes a gap field (e.g. color) when the user fills it in, even though it started blank', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildProjectDocument(rec));
    doc.fields.color = '#ff0000';

    expect(buildProjectPatch(rec, doc)).toEqual({ color: '#ff0000' });
  });
});

describe('buildMilestoneDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildMilestoneDocument(milestone({ name: 'Launch', status: 'in_progress' }));
    expect(text).toContain('name: Launch');
    expect(text).toContain('status: in_progress');
  });

  it('excludes description from the frontmatter and uses it as the document body', () => {
    const text = buildMilestoneDocument(milestone({ description: 'Ship it.' }));
    expect(text.split('\n').some((l) => l.trimStart().startsWith('description:'))).toBe(false);
    expect(text.endsWith('Ship it.')).toBe(true);
  });
});

describe('buildMilestonePatch', () => {
  it('is empty when the document round-trips with no edits', () => {
    const rec = milestone();
    const doc: EditorDocument = parseDocument(buildMilestoneDocument(rec));
    expect(buildMilestonePatch(rec, doc)).toEqual({});
  });

  it('includes only the field that changed', () => {
    const rec = milestone({ name: 'Old Name' });
    const doc: EditorDocument = parseDocument(buildMilestoneDocument(rec));
    doc.fields.name = 'New Name';

    expect(buildMilestonePatch(rec, doc)).toEqual({ name: 'New Name' });
  });

  it('includes description when the user types something into the body', () => {
    const rec = milestone();
    const doc: EditorDocument = parseDocument(buildMilestoneDocument(rec));
    doc.body = 'A revised plan.';

    expect(buildMilestonePatch(rec, doc)).toEqual({ description: 'A revised plan.' });
  });

  it('sends null when the user clears a field that had a value', () => {
    const rec = milestone({ ownerUserId: 'bbbbbbbb-2222-2222-2222-222222222222' });
    const doc: EditorDocument = parseDocument(buildMilestoneDocument(rec));
    delete doc.fields.ownerUserId;

    expect(buildMilestonePatch(rec, doc)).toEqual({ ownerUserId: null });
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
});
