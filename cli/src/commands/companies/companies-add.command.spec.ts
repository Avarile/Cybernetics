import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { CompaniesAddCommand } from './companies-add.command';

describe('CompaniesAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new CompaniesAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'cccccccc-3333-3333-3333-333333333333', name: 'Acme Corp' });
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

  it('creates a company from flags without opening the editor', async () => {
    await make().run([], { name: 'Acme Corp', domain: 'acme.example', industry: 'Software' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/companies', {
      name: 'Acme Corp',
      domain: 'acme.example',
      industry: 'Software',
    });
    expect(out.join('')).toContain('Acme Corp');
  });

  it('opens the editor when no field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toContain('name:');
  });

  it('--no-edit without flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires --name when using flags', async () => {
    await expect(make().run([], { domain: 'acme.example', edit: false })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('submitting the editor buffer posts the parsed fields', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { name: 'Acme Corp', domain: 'acme.example' }, body: '' });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/companies', { name: 'Acme Corp', domain: 'acme.example' });
  });
});
