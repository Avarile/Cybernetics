import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError } from '../../core/errors';
import { parseDocument } from '../../core/editor/frontmatter';
import { ProjectsEditCommand } from './projects-edit.command';
import { buildProjectDocument, type ProjectRecord } from './projects.helpers';

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

describe('ProjectsEditCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new ProjectsEditCommand(settings, clients, editor);

  beforeEach(() => {
    patch = jest.fn().mockResolvedValue({ key: 'CYB', name: 'Cybernetics' });
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    editorRun = jest.fn();
    editor = { run: editorRun } as unknown as EditorService;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves by key, opens the editor pre-filled with the same shape get renders', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    editorRun.mockResolvedValue(undefined);

    await make().run([rec.id], {});

    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toBe(buildProjectDocument(rec));
  });

  it('sends only the field that changed', async () => {
    const rec = record({ name: 'Old Name' });
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.name = 'New Name';
      await opts.submit(doc);
    });

    await make().run([rec.id], {});

    expect(patch).toHaveBeenCalledWith(`/projects/${rec.id}`, { name: 'New Name' });
  });

  it('prints "No changes" and does not PATCH when the document is untouched', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      await opts.submit(doc);
    });

    await make().run([rec.id], {});

    expect(patch).not.toHaveBeenCalled();
    expect(out.join('')).toContain('No changes');
  });

  it('propagates a 404 from the server without retrying', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    patch.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Project not found'));

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.name = 'New Name';
      await opts.submit(doc);
    });

    await expect(make().run([rec.id], {})).rejects.toMatchObject({ exitCode: 4 });
  });
});
