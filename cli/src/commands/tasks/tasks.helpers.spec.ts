import { parseDocument, type EditorDocument } from '../../core/editor/frontmatter';
import type { ApiClient } from '../../core/http/api.client';
import {
  buildTaskDocument,
  buildTaskPatch,
  morePagesNote,
  resolveProjectKeys,
  TASKS_CREATE_SCHEMA,
  TASKS_EDIT_SCHEMA,
  type TaskRecord,
} from './tasks.helpers';

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'eeeeeeee-5555-5555-5555-555555555555',
    projectId: 'aaaaaaaa-1111-1111-1111-111111111111',
    milestoneId: null,
    parentTaskId: null,
    number: 42,
    title: 'Ship the thing',
    description: null,
    status: 'todo',
    priority: 'medium',
    assigneeUserId: null,
    reporterUserId: null,
    estimateMinutes: null,
    spentMinutes: 0,
    startDate: null,
    dueDate: null,
    completedAt: null,
    blockedReason: null,
    sortRank: null,
    externalRef: null,
    metadata: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('TASKS_EDIT_SCHEMA', () => {
  it('carries every UpdateTaskDto field, unmodified — there is no expectedVersion to strip', () => {
    const props = (TASKS_EDIT_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['title', 'status', 'priority', 'tagIds', 'description']),
    );
    expect(Object.keys(props)).not.toContain('expectedVersion');
  });
});

describe('TASKS_CREATE_SCHEMA', () => {
  it('is CreateTaskDto, unmodified, with projectId and title required', () => {
    const schema = TASKS_CREATE_SCHEMA as { required?: string[] };
    expect(schema.required).toEqual(['projectId', 'title']);
  });
});

describe('buildTaskDocument', () => {
  it('renders the record fields uncommented, populated from the record', () => {
    const text = buildTaskDocument(record({ title: 'Hello', status: 'in_progress' }));
    expect(text).toContain('title: Hello');
    expect(text).toContain('status: in_progress');
  });

  it('excludes description from the frontmatter and uses it as the document body', () => {
    const text = buildTaskDocument(record({ description: 'Some notes' }));
    expect(text.split('\n').some((l) => l.trimStart().startsWith('description:'))).toBe(false);
    expect(text.endsWith('Some notes')).toBe(true);
  });

  it('renders the header facts about tagIds and about description becoming the body', () => {
    const text = buildTaskDocument(record());
    expect(text).toContain('YYYY-MM-DD');
    expect(text).toContain('never returns it');
    expect(text).toContain("becomes the task's description");
  });

  it('renders tagIds as an empty array — never returned by GET', () => {
    const text = buildTaskDocument(record());
    const line = text.split('\n').find((l) => l.startsWith('tagIds:'));
    expect(line).toMatch(/^tagIds: \[\]/);
  });
});

describe('buildTaskPatch', () => {
  it('is empty when the document round-trips with no edits', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildTaskDocument(rec));
    expect(buildTaskPatch(rec, doc)).toEqual({});
  });

  it('includes only the field that changed', () => {
    const rec = record({ title: 'Old title' });
    const doc: EditorDocument = parseDocument(buildTaskDocument(rec));
    doc.fields.title = 'New title';

    expect(buildTaskPatch(rec, doc)).toEqual({ title: 'New title' });
  });

  it('includes description when the user types something into the body', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildTaskDocument(rec));
    doc.body = 'More detail here.';

    expect(buildTaskPatch(rec, doc)).toEqual({ description: 'More detail here.' });
  });

  it('sends null when the user clears a field that had a value', () => {
    const rec = record({ assigneeUserId: 'bbbbbbbb-2222-2222-2222-222222222222' });
    const doc: EditorDocument = parseDocument(buildTaskDocument(rec));
    delete doc.fields.assigneeUserId;

    expect(buildTaskPatch(rec, doc)).toEqual({ assigneeUserId: null });
  });

  it('includes tagIds when the user fills it in, even though it started empty', () => {
    const rec = record();
    const doc: EditorDocument = parseDocument(buildTaskDocument(rec));
    doc.fields.tagIds = ['id-1'];

    expect(buildTaskPatch(rec, doc)).toEqual({ tagIds: ['id-1'] });
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

describe('resolveProjectKeys', () => {
  it('fetches each distinct project id once and maps it to its key', async () => {
    const get = jest.fn().mockImplementation((path: string) => {
      if (path === '/projects/aaaaaaaa-1111-1111-1111-111111111111') return Promise.resolve({ key: 'CYB' });
      if (path === '/projects/bbbbbbbb-2222-2222-2222-222222222222') return Promise.resolve({ key: 'ACME' });
      throw new Error(`unexpected path ${path}`);
    });
    const client = { get } as unknown as ApiClient;

    const map = await resolveProjectKeys(
      [
        'aaaaaaaa-1111-1111-1111-111111111111',
        'bbbbbbbb-2222-2222-2222-222222222222',
        'aaaaaaaa-1111-1111-1111-111111111111',
      ],
      client,
    );

    expect(get).toHaveBeenCalledTimes(2);
    expect(map.get('aaaaaaaa-1111-1111-1111-111111111111')).toBe('CYB');
    expect(map.get('bbbbbbbb-2222-2222-2222-222222222222')).toBe('ACME');
  });

  it('returns an empty map for an empty input without making any calls', async () => {
    const get = jest.fn();
    const client = { get } as unknown as ApiClient;

    const map = await resolveProjectKeys([], client);

    expect(get).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });
});
