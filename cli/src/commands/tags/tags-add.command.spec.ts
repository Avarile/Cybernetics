import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { TagsAddCommand } from './tags-add.command';

describe('TagsAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new TagsAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'cccccccc-3333-3333-3333-333333333333', key: 'security', label: 'Security' });
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

  it('creates a tag from flags without opening the editor', async () => {
    await make().run([], { key: 'security', label: 'Security', scope: 'contact', color: '#fff', description: 'sec' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/tags', {
      key: 'security',
      label: 'Security',
      scope: 'contact',
      color: '#fff',
      description: 'sec',
    });
    expect(out.join('')).toContain('security');
  });

  it('omits scope when not given, letting the server default to shared', async () => {
    await make().run([], { key: 'urgent', label: 'Urgent' });

    expect(post).toHaveBeenCalledWith('/tags', { key: 'urgent', label: 'Urgent' });
  });

  it('opens the editor when no field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toContain('key:');
    expect(opts.initial).toContain('label:');
  });

  it('--edit forces the editor even when flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], { key: 'security', label: 'Security', edit: true });

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('--no-edit without flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires --key when using flags', async () => {
    await expect(make().run([], { label: 'Security', edit: false })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('requires --label when using flags', async () => {
    await expect(make().run([], { key: 'security', edit: false })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('submitting the editor buffer posts the parsed fields', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { key: 'security', label: 'Security', scope: 'contact' }, body: '' });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/tags', { key: 'security', label: 'Security', scope: 'contact' });
  });
});
