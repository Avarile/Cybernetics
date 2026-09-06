import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { ProjectsAddCommand } from './projects-add.command';

describe('ProjectsAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new ProjectsAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' });
    clients = { create: () => ({ post }) } as unknown as ClientFactory;
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
    expect(opts.initial).toContain('key:');
    expect(opts.initial).toContain('name:');
  });

  it('submits the parsed document from the editor', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { key: 'CYB', name: 'Cybernetics' }, body: 'Mission statement' });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/projects', { key: 'CYB', name: 'Cybernetics', description: 'Mission statement' });
    expect(out.join('')).toContain('CYB');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], { key: 'CYB', name: 'Cybernetics', status: 'active' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/projects', { key: 'CYB', name: 'Cybernetics', status: 'active' });
  });

  it('--edit forces the editor even when field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], { key: 'CYB', name: 'Cybernetics', edit: true });

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires --key in flag mode', async () => {
    await expect(make().run([], { name: 'Cybernetics' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('requires --name in flag mode', async () => {
    await expect(make().run([], { key: 'CYB' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('maps --tags to a tagIds array', async () => {
    await make().run([], { key: 'CYB', name: 'Cybernetics', tags: 'id-1, id-2' });

    expect(post).toHaveBeenCalledWith('/projects', { key: 'CYB', name: 'Cybernetics', tagIds: ['id-1', 'id-2'] });
  });

  it('maps --lead-user-id to leadUserId', async () => {
    await make().run([], { key: 'CYB', name: 'Cybernetics', leadUserId: 'bbbbbbbb-2222-2222-2222-222222222222' });

    expect(post).toHaveBeenCalledWith('/projects', {
      key: 'CYB',
      name: 'Cybernetics',
      leadUserId: 'bbbbbbbb-2222-2222-2222-222222222222',
    });
  });
});
