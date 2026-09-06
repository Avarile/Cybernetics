import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import { UsageError } from '../../core/errors';
import { ProjectsMilestoneEditCommand } from './projects-milestone-edit.command';
import type { MilestoneRecord } from './projects.helpers';

function milestone(overrides: Partial<MilestoneRecord> = {}): MilestoneRecord {
  return {
    id: 'cccccccc-3333-3333-3333-333333333333',
    projectId: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Beta launch',
    description: null,
    status: 'pending',
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

describe('ProjectsMilestoneEditCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const PROJECT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
  const MILESTONE_ID = 'cccccccc-3333-3333-3333-333333333333';

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new ProjectsMilestoneEditCommand(settings, clients, editor);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue([milestone()]);
    patch = jest.fn().mockResolvedValue({ name: 'Beta launch' });
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

  it('fetches the milestone list, finds the id, and opens the editor pre-filled', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([PROJECT_ID, MILESTONE_ID], {});

    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toContain('name: Beta launch');
  });

  it('sends only the field that changed, PATCHing /projects/milestones/:id', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.status = 'reached';
      await opts.submit(doc);
    });

    await make().run([PROJECT_ID, MILESTONE_ID], {});

    expect(patch).toHaveBeenCalledWith(`/projects/milestones/${MILESTONE_ID}`, { status: 'reached' });
  });

  it('prints "No changes" and does not PATCH when the document is untouched', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      await opts.submit(doc);
    });

    await make().run([PROJECT_ID, MILESTONE_ID], {});

    expect(patch).not.toHaveBeenCalled();
    expect(out.join('')).toContain('No changes');
  });

  it('exits 2 when the milestone id does not belong to this project', async () => {
    await expect(make().run([PROJECT_ID, 'dddddddd-4444-4444-4444-444444444444'], {})).rejects.toThrow(
      UsageError,
    );
    expect(editorRun).not.toHaveBeenCalled();
  });
});
