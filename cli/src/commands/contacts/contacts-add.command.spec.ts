import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError, UsageError } from '../../core/errors';
import { ContactsAddCommand } from './contacts-add.command';

describe('ContactsAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new ContactsAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', displayName: 'Ada Lovelace' });
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
    expect(opts.initial).toContain('displayName:');
  });

  it('submits the parsed document from the editor', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { displayName: 'From Editor' }, body: 'met at a talk' });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/contacts', { displayName: 'From Editor', notes: 'met at a talk' });
    expect(out.join('')).toContain('Ada Lovelace');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], { displayName: 'Flagged Name', status: 'inactive' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/contacts', { displayName: 'Flagged Name', status: 'inactive' });
  });

  it('--edit forces the editor even when field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], { displayName: 'Flagged Name', edit: true });

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
    // resolution, so it uses well-formed UUIDs rather than the arbitrary
    // strings a real key lookup would need `client.get` stubbed for (see
    // the 'key-backed fields' describe block below for that).
    await make().run([], {
      displayName: 'T',
      tags: '11111111-1111-1111-1111-111111111111, 22222222-2222-2222-2222-222222222222',
    });

    expect(post).toHaveBeenCalledWith('/contacts', {
      displayName: 'T',
      tagIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    });
  });

  it('maps --primary-email to primaryEmail', async () => {
    await make().run([], { primaryEmail: 'ada@example.com' });

    expect(post).toHaveBeenCalledWith('/contacts', { primaryEmail: 'ada@example.com' });
  });

  // --- The trap this project has hit before: CreateContactDto's cross-field
  // rule ("Provide a name or an email address") doesn't survive to JSON
  // Schema (confirmed against src/generated/schemas.ts: no `required` array
  // at all), so a submission satisfying none of displayName/firstName/
  // lastName/primaryEmail 400s with a single issue whose `path` is the
  // literal string '(root)' (see api/src/common/pipes/zod-validation.pipe.ts
  // and cli/src/core/errors/envelope.ts's normalizeIssuePath doc comment).
  // annotate() can't anchor '(root)' to any frontmatter key, so it must land
  // in the header block instead of being dropped — this exercises the real
  // EditorService (not a stub) end-to-end to prove that actually happens.
  it('a (root) 400 from the cross-field rule re-opens the buffer annotated, rather than crashing', async () => {
    const rootIssue = { path: ['(root)'], message: 'Provide a name or an email address' };
    post
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [rootIssue]))
      .mockResolvedValueOnce({ id: 'aaaaaaaa-1111-1111-1111-111111111111', displayName: 'Ada Lovelace' });

    const reads: string[] = [];
    let round = 0;
    const launch = async (_cmd: string, file: string): Promise<number> => {
      round += 1;
      reads.push(readFileSync(file, 'utf-8'));
      if (round === 1) {
        // The user saves without uncommenting anything — every field stays
        // commented out, so the submitted document is empty. Something must
        // still change on disk or EditorService treats this as "no changes"
        // and aborts before ever submitting.
        writeFileSync(file, `${reads[0]}\n`);
      } else {
        writeFileSync(file, reads[0].replace('# displayName:', 'displayName: Ada Lovelace'));
      }
      return 0;
    };

    const realEditor = new EditorService({ launch, env: {} });
    await new ContactsAddCommand(settings, clients, realEditor).run([], {});

    expect(post).toHaveBeenCalledTimes(2);
    expect(reads[1]).toContain('✗ (root): Provide a name or an email address');
    expect(out.join('')).toContain('Ada Lovelace');
  });

  // --- Task 5: key-backed fields (type/category/tags/company) resolve via
  // the real VocabularyIndex (Task 1), not a stub -- these tests only stub
  // `client.get`'s HTTP responses, so the wiring between the two modules is
  // genuinely exercised.
  describe('key-backed fields', () => {
    const TYPE_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
    const TAG_SECURITY_ID = 'cccccccc-1111-1111-1111-111111111111';
    const TAG_URGENT_ID = 'cccccccc-2222-2222-2222-222222222222';

    function get(): jest.Mock {
      return jest.fn(async (url: string) => {
        if (url === '/contact-vocabulary/types') {
          return [{ id: TYPE_ID, key: 'customer', name: 'Customer' }];
        }
        if (url.startsWith('/tags?scope=contact')) {
          return {
            data: [
              { id: TAG_SECURITY_ID, key: 'security', scope: 'contact' },
              { id: TAG_URGENT_ID, key: 'urgent', scope: 'contact' },
            ],
            total: 2,
            page: 1,
            limit: 100,
          };
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
        await opts.submit({ fields: { displayName: 'Ada', type: 'customer' }, body: '' });
      });

      await make().run([], {});

      expect(post).toHaveBeenCalledWith('/contacts', { displayName: 'Ada', typeId: TYPE_ID });
    });

    it('resolves multiple tag keys before POST', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        await opts.submit({ fields: { displayName: 'Ada', tags: ['security', 'urgent'] }, body: '' });
      });

      await make().run([], {});

      expect(post).toHaveBeenCalledWith('/contacts', { displayName: 'Ada', tagIds: [TAG_SECURITY_ID, TAG_URGENT_ID] });
    });

    it('passes a raw UUID straight through with zero vocabulary HTTP calls', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;
      const rawUuid = 'dddddddd-1111-1111-1111-111111111111';

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        await opts.submit({ fields: { displayName: 'Ada', type: rawUuid }, body: '' });
      });

      await make().run([], {});

      expect(post).toHaveBeenCalledWith('/contacts', { displayName: 'Ada', typeId: rawUuid });
      expect(getMock).not.toHaveBeenCalled();
    });

    it('an unknown key from the buffer re-opens the editor annotated (exit 2), rather than crashing', async () => {
      const getMock = get();
      post.mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', displayName: 'Ada' });
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      const reads: string[] = [];
      let round = 0;
      const launch = async (_cmd: string, file: string): Promise<number> => {
        round += 1;
        reads.push(readFileSync(file, 'utf-8'));
        if (round === 1) {
          writeFileSync(file, reads[0].replace('# displayName:', 'displayName: Ada').replace('# type:', 'type: bogus'));
        } else {
          writeFileSync(file, reads[0].replace('type: bogus', 'type: customer'));
        }
        return 0;
      };

      const realEditor = new EditorService({ launch, env: {} });
      await new ContactsAddCommand(settings, clients, realEditor).run([], {});

      expect(post).toHaveBeenCalledTimes(1);
      expect(reads[1]).toContain('✗ type:');
      expect(reads[1]).toContain('Unknown contact type key "bogus"');
    });

    it('--type <key> resolves on the flag-only path', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      await make().run([], { displayName: 'Ada', type: 'customer' });

      expect(post).toHaveBeenCalledWith('/contacts', { displayName: 'Ada', typeId: TYPE_ID });
    });

    it('an unknown key on the flag-only path propagates as a bare UsageError, exit 2 -- no buffer to annotate', async () => {
      const getMock = get();
      clients = { create: () => ({ post, get: getMock }) } as unknown as ClientFactory;

      await expect(make().run([], { displayName: 'Ada', type: 'bogus' })).rejects.toThrow(UsageError);
    });
  });
});
