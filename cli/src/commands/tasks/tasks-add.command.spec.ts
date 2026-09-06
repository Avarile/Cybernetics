import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { TasksAddCommand } from './tasks-add.command';

describe('TasksAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const PROJECT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new TasksAddCommand(settings, clients, editor);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      data: [{ id: PROJECT_ID, key: 'CYB', name: 'Cybernetics' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    post = jest.fn().mockResolvedValue({ id: 'eeeeeeee-5555-5555-5555-555555555555', title: 'Ship the thing', number: 42 });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;
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

  it('opens the editor when no field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.filetype).toBe('md');
    expect(opts.initial).toContain('projectId:');
    expect(opts.initial).toContain('title:');
  });

  it('submits the parsed document from the editor', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { projectId: PROJECT_ID, title: 'Ship the thing' }, body: 'Details' });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/tasks', { projectId: PROJECT_ID, title: 'Ship the thing', description: 'Details' });
    expect(out.join('')).toContain('Ship the thing');
  });

  it('skips the editor when field flags are given, resolving --project to a projectId', async () => {
    await make().run([], { project: 'CYB', title: 'Ship the thing', status: 'in_progress' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/tasks', { projectId: PROJECT_ID, title: 'Ship the thing', status: 'in_progress' });
  });

  it('--edit forces the editor even when field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], { project: 'CYB', title: 'Ship the thing', edit: true });

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires --project in flag mode', async () => {
    await expect(make().run([], { title: 'x' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('requires --title in flag mode', async () => {
    await expect(make().run([], { project: 'CYB' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('maps --tags to a tagIds array', async () => {
    await make().run([], { project: 'CYB', title: 'x', tags: 'id-1, id-2' });

    expect(post).toHaveBeenCalledWith('/tasks', { projectId: PROJECT_ID, title: 'x', tagIds: ['id-1', 'id-2'] });
  });

  it('accepts a well-formed project UUID straight through without a lookup call', async () => {
    await make().run([], { project: 'bbbbbbbb-2222-2222-2222-222222222222', title: 'x' });

    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/tasks', { projectId: 'bbbbbbbb-2222-2222-2222-222222222222', title: 'x' });
  });
});
