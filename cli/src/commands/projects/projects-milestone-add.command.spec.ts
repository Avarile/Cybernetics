import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { ProjectsMilestoneAddCommand } from './projects-milestone-add.command';

describe('ProjectsMilestoneAddCommand', () => {
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

  const make = () => new ProjectsMilestoneAddCommand(settings, clients, editor);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      data: [{ id: PROJECT_ID, key: 'CYB', name: 'Cybernetics' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    post = jest.fn().mockResolvedValue({ id: 'cccccccc-3333-3333-3333-333333333333', name: 'Beta launch' });
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

    await make().run(['CYB'], {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.filetype).toBe('md');
    expect(opts.initial).toContain('name:');
  });

  it('submits the parsed document from the editor', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { name: 'Beta launch' }, body: 'Ship it' });
    });

    await make().run(['CYB'], {});

    expect(post).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/milestones`, {
      name: 'Beta launch',
      description: 'Ship it',
    });
    expect(out.join('')).toContain('Beta launch');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run(['CYB'], { name: 'Beta launch', status: 'in_progress' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/milestones`, {
      name: 'Beta launch',
      status: 'in_progress',
    });
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run(['CYB'], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires --name in flag mode', async () => {
    await expect(make().run(['CYB'], { status: 'pending' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });
});
