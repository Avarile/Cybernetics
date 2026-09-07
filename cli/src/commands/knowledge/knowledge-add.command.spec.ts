import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
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

  it('maps --tags to a tagIds array, comma-split and trimmed', async () => {
    // Raw UUIDs pass through vocab.toIds with zero HTTP calls (Task 1's
    // contract) -- this test is about comma-splitting/trimming, not
    // resolution (see the 'key-backed fields' describe block below for that).
    await make().run([], {
      title: 'T',
      tags: '11111111-1111-1111-1111-111111111111, 22222222-2222-2222-2222-222222222222',
    });

    expect(post).toHaveBeenCalledWith('/knowledge', {
      title: 'T',
      tagIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    });
  });

  it('requires --title when creating via flags without a title', async () => {
    await expect(make().run([], { visibility: 'internal' })).rejects.toThrow(UsageError);
  });

  // --- Task 5: key-backed fields resolve via the real VocabularyIndex --
  // only client.get's HTTP responses are stubbed.
  describe('key-backed fields', () => {
    const TYPE_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
    const TAG_SECURITY_ID = 'cccccccc-1111-1111-1111-111111111111';

    function get(): jest.Mock {
      return jest.fn(async (url: string) => {
        if (url === '/knowledge-vocabulary/types') {
          return [{ id: TYPE_ID, key: 'howto', name: 'How-to' }];
        }
        if (url.startsWith('/tags?scope=knowledge')) {
          return { data: [{ id: TAG_SECURITY_ID, key: 'security', scope: 'knowledge' }], total: 1, page: 1, limit: 100 };
        }
        if (url.startsWith('/tags?scope=shared')) {
          return { data: [], total: 0, page: 1, limit: 100 };
        }
        throw new Error(`unexpected client.get(${url})`);
      });
    }

    it('resolves a buffer key to an id before POST', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        await opts.submit({ fields: { title: 'T', type: 'howto' }, body: '' });
      });

      await make().run([], {});

      expect(post).toHaveBeenCalledWith('/knowledge', { title: 'T', typeId: TYPE_ID });
    });

    it('has no company field to resolve -- knowledge DTOs carry no companyId', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        await opts.submit({ fields: { title: 'T', tags: ['security'] }, body: '' });
      });

      await make().run([], {});

      expect(post).toHaveBeenCalledWith('/knowledge', { title: 'T', tagIds: [TAG_SECURITY_ID] });
    });

    it('--type <key> resolves on the flag-only path', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      await make().run([], { title: 'T', type: 'howto' });

      expect(post).toHaveBeenCalledWith('/knowledge', { title: 'T', typeId: TYPE_ID });
    });

    it('an unknown key from the buffer re-opens the editor annotated (exit 2), rather than crashing', async () => {
      const getMock = get();
      post.mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', slug: 'a-title' });
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      const reads: string[] = [];
      let round = 0;
      const launch = async (_cmd: string, file: string): Promise<number> => {
        round += 1;
        reads.push(readFileSync(file, 'utf-8'));
        if (round === 1) {
          writeFileSync(file, reads[0].replace('# title:', 'title: T').replace('# type:', 'type: bogus'));
        } else {
          writeFileSync(file, reads[0].replace('type: bogus', 'type: howto'));
        }
        return 0;
      };

      const realEditor = new EditorService({ launch, env: {} });
      await new KnowledgeAddCommand(settings, clients, realEditor).run([], {});

      expect(post).toHaveBeenCalledTimes(1);
      expect(reads[1]).toContain('✗ type:');
      expect(reads[1]).toContain('Unknown knowledge type key "bogus"');
    });

    it('an unknown key on the flag-only path propagates as a bare UsageError, exit 2', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      await expect(make().run([], { title: 'T', type: 'bogus' })).rejects.toThrow(UsageError);
    });
  });
});
