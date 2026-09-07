import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError } from '../../core/errors';
import { parseDocument } from '../../core/editor/frontmatter';
import { ContactsEditCommand } from './contacts-edit.command';
import { buildContactDocument, type ContactRecord } from './contacts.helpers';

// `rec`'s companyId/typeId/categoryId are all null and tagIds is empty, so
// this is what resolveContactKeyBacked resolves to for it -- no HTTP call
// needed either way (see contacts.helpers.spec.ts for that behaviour
// exercised directly).
const NO_KEY_BACKED_VALUES = { type: null, category: null, tags: [], company: null };

function record(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    displayName: 'Ada Lovelace',
    firstName: 'Ada',
    lastName: 'Lovelace',
    primaryEmail: 'ada@example.com',
    primaryPhone: null,
    jobTitle: null,
    companyId: null,
    typeId: null,
    categoryId: null,
    ownerUserId: null,
    status: 'active',
    source: 'manual',
    visibility: 'private',
    country: null,
    lastContactedAt: null,
    nextFollowUpAt: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ContactsEditCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new ContactsEditCommand(settings, clients, editor);

  beforeEach(() => {
    patch = jest.fn().mockResolvedValue({ displayName: 'Ada Lovelace' });
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

  it('resolves by UUID, opens the editor pre-filled with the same shape get renders', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    editorRun.mockResolvedValue(undefined);

    await make().run([rec.id], {});

    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toBe(buildContactDocument(rec, NO_KEY_BACKED_VALUES));
  });

  it('sends only the field that changed — no expectedVersion, contacts carries no version field', async () => {
    const rec = record({ displayName: 'Old Name' });
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.displayName = 'New Name';
      await opts.submit(doc);
    });

    await make().run([rec.id], {});

    expect(patch).toHaveBeenCalledWith(`/contacts/${rec.id}`, { displayName: 'New Name' });
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

  it('propagates a 404 from the server without retrying', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    patch.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Contact not found'));

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.displayName = 'New Name';
      await opts.submit(doc);
    });

    await expect(make().run([rec.id], {})).rejects.toMatchObject({ exitCode: 4 });
  });

  // --- Task 5: key-backed fields resolve/reverse-map via the real
  // VocabularyIndex -- only `client.get`'s HTTP responses are stubbed, so
  // this genuinely exercises the wiring between contacts.helpers.ts and
  // core/resolve/vocabulary.ts.
  describe('key-backed fields', () => {
    const TYPE_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
    const OTHER_TYPE_ID = 'bbbbbbbb-2222-2222-2222-222222222222';

    function dispatchingGet(rec: ContactRecord): jest.Mock {
      return jest.fn(async (url: string) => {
        if (url === `/contacts/${rec.id}`) return rec;
        if (url === '/contact-vocabulary/types') {
          return [
            { id: TYPE_ID, key: 'customer', name: 'Customer' },
            { id: OTHER_TYPE_ID, key: 'enterprise', name: 'Enterprise' },
          ];
        }
        throw new Error(`unexpected client.get(${url})`);
      });
    }

    it('renders the resolved key in the initial buffer, not the raw id', async () => {
      const rec = record({ typeId: TYPE_ID });
      get = dispatchingGet(rec);
      clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
      editorRun.mockResolvedValue(undefined);

      await make().run([rec.id], {});

      const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
      expect(opts.initial).toContain('type: customer');
      expect(opts.initial.split('\n').some((l) => l.startsWith('typeId:'))).toBe(false);
    });

    it('an unchanged key-backed field is absent from the PATCH', async () => {
      const rec = record({ typeId: TYPE_ID });
      get = dispatchingGet(rec);
      clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        const doc = parseDocument(opts.initial);
        doc.fields.displayName = 'New Name';
        await opts.submit(doc);
      });

      await make().run([rec.id], {});

      expect(patch).toHaveBeenCalledWith(`/contacts/${rec.id}`, { displayName: 'New Name' });
    });

    it('a changed key-backed field resolves to its id in the PATCH', async () => {
      const rec = record({ typeId: TYPE_ID });
      get = dispatchingGet(rec);
      clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        const doc = parseDocument(opts.initial);
        doc.fields.type = 'enterprise';
        await opts.submit(doc);
      });

      await make().run([rec.id], {});

      expect(patch).toHaveBeenCalledWith(`/contacts/${rec.id}`, { typeId: OTHER_TYPE_ID });
    });

    it('an unknown key re-opens the real editor annotated (exit 2) instead of discarding the edit', async () => {
      const rec = record({ typeId: TYPE_ID });
      get = dispatchingGet(rec);
      clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
      patch.mockResolvedValue({ displayName: 'Ada Lovelace' });

      const reads: string[] = [];
      let round = 0;
      const launch = async (_cmd: string, file: string): Promise<number> => {
        round += 1;
        reads.push(readFileSync(file, 'utf-8'));
        if (round === 1) {
          writeFileSync(file, reads[0].replace('type: customer', 'type: bogus'));
        } else {
          writeFileSync(file, reads[0].replace('type: customer', 'type: enterprise'));
        }
        return 0;
      };

      const realEditor = new EditorService({ launch, env: {} });
      await new ContactsEditCommand(settings, clients, realEditor).run([rec.id], {});

      expect(patch).toHaveBeenCalledTimes(1);
      expect(patch).toHaveBeenCalledWith(`/contacts/${rec.id}`, { typeId: OTHER_TYPE_ID });
      expect(reads[1]).toContain('✗ type:');
      expect(reads[1]).toContain('Unknown contact type key "bogus"');
    });
  });
});
