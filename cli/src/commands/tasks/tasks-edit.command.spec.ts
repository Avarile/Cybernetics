import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError } from '../../core/errors';
import { parseDocument } from '../../core/editor/frontmatter';
import { TasksEditCommand } from './tasks-edit.command';
import { buildTaskDocument, type TaskRecord } from './tasks.helpers';

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

describe('TasksEditCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new TasksEditCommand(settings, clients, editor);

  beforeEach(() => {
    patch = jest.fn().mockResolvedValue({ title: 'Ship the thing' });
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

  it('resolves by id, opens the editor pre-filled with the same shape get renders', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    editorRun.mockResolvedValue(undefined);

    await make().run([rec.id], {});

    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toBe(buildTaskDocument(rec));
  });

  it('sends only the field that changed', async () => {
    const rec = record({ title: 'Old title' });
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.title = 'New title';
      await opts.submit(doc);
    });

    await make().run([rec.id], {});

    expect(patch).toHaveBeenCalledWith(`/tasks/${rec.id}`, { title: 'New title' });
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

  // Exercises the real EditorService (not a stub) end to end, the same way
  // ContactsAddCommand's (root) 400 test does: `status: blocked` with no
  // `blockedReason` is enforced by TaskService.update itself (not the DTO
  // schema — see task.service.ts), so it 400s with an issue at that path,
  // and the retry loop must re-open the buffer annotated rather than crash.
  it('re-opens the buffer annotated when moving to blocked with no blockedReason 400s', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    const issue = { path: ['blockedReason'], message: 'A blocked task must say what is blocking it' };
    patch
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [issue]))
      .mockResolvedValueOnce({ title: 'Ship the thing' });

    const reads: string[] = [];
    let round = 0;
    const launch = async (_cmd: string, file: string): Promise<number> => {
      round += 1;
      reads.push(readFileSync(file, 'utf-8'));
      if (round === 1) {
        // Anchored to line start (not end): the real `status:` line carries a
        // trailing `# ...` facts comment (its enum values), so the match
        // must not require the line to end right after "todo".
        writeFileSync(file, reads[0].replace(/^status: todo/m, 'status: blocked'));
      } else {
        // Anchored to line start: the annotation comment inserted above also
        // contains the literal text "blockedReason:" (as part of "# ✗
        // blockedReason: ..."), so an unanchored replace would edit the
        // comment instead of the real field line.
        writeFileSync(
          file,
          reads[round - 1].replace(/^blockedReason:/m, 'blockedReason: Waiting on design'),
        );
      }
      return 0;
    };

    const realEditor = new EditorService({ launch, env: {} });
    await new TasksEditCommand(settings, clients, realEditor).run([rec.id], {});

    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenNthCalledWith(1, `/tasks/${rec.id}`, { status: 'blocked' });
    expect(patch).toHaveBeenNthCalledWith(2, `/tasks/${rec.id}`, {
      status: 'blocked',
      blockedReason: 'Waiting on design',
    });
    expect(reads[1]).toContain('✗ blockedReason: A blocked task must say what is blocking it');
    expect(out.join('')).toContain('Ship the thing');
  });

  it('propagates a 404 from the server without retrying', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    patch.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Task not found'));

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.title = 'New title';
      await opts.submit(doc);
    });

    await expect(make().run([rec.id], {})).rejects.toMatchObject({ exitCode: 4 });
  });
});
