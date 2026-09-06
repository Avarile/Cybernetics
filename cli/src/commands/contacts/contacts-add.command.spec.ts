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

  it('maps --tags to a tagIds array', async () => {
    await make().run([], { displayName: 'T', tags: 'id-1, id-2' });

    expect(post).toHaveBeenCalledWith('/contacts', { displayName: 'T', tagIds: ['id-1', 'id-2'] });
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
});
