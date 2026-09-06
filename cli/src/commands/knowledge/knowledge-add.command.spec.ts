import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { KnowledgeAddCommand } from './knowledge-add.command';

describe('KnowledgeAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new KnowledgeAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', slug: 'a-title' });
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
    expect(opts.initial).toContain('title:');
  });

  it('submits the parsed document from the editor', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { title: 'From Editor' }, body: 'body text' });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/knowledge', { title: 'From Editor', body: 'body text' });
    expect(out.join('')).toContain('a-title');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], { title: 'Flagged Title', visibility: 'internal' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/knowledge', { title: 'Flagged Title', visibility: 'internal' });
  });

  it('--edit forces the editor even when field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], { title: 'Flagged Title', edit: true });

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('maps --tags to a tagIds array', async () => {
    await make().run([], { title: 'T', tags: 'id-1, id-2' });

    expect(post).toHaveBeenCalledWith('/knowledge', { title: 'T', tagIds: ['id-1', 'id-2'] });
  });

  it('requires --title when creating via flags without a title', async () => {
    await expect(make().run([], { visibility: 'internal' })).rejects.toThrow(UsageError);
  });
});
