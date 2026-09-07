import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError } from '../../core/errors';
import { KnowledgeEditCommand } from './knowledge-edit.command';
import { buildKnowledgeDocument, type KnowledgeRecord } from './knowledge.helpers';
import { parseDocument } from '../../core/editor/frontmatter';

// `rec`'s typeId/categoryId are null and tagIds is empty, so this is what
// resolveKnowledgeKeyBacked resolves to for it -- no HTTP call needed.
const NO_KEY_BACKED_VALUES = { type: null, category: null, tags: [] };

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    title: 'Existing Title',
    slug: 'existing-title',
    summary: null,
    body: 'Existing body.',
    format: 'markdown',
    status: 'draft',
    visibility: 'private',
    version: 5,
    typeId: null,
    categoryId: null,
    ownerUserId: null,
    sourceUrl: null,
    sourceFileId: null,
    language: 'en',
    publishedAt: null,
    reviewDueAt: null,
    tagIds: [],
    access: 'manage',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('KnowledgeEditCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new KnowledgeEditCommand(settings, clients, editor);

  beforeEach(() => {
    patch = jest.fn().mockResolvedValue({ slug: 'existing-title' });
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

  it('fetches by UUID, opens the editor pre-filled with the same shape get renders', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    editorRun.mockResolvedValue(undefined);

    await make().run([rec.id], {});

    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toBe(buildKnowledgeDocument(rec, NO_KEY_BACKED_VALUES));
  });

  it('sends only the changed field, plus expectedVersion', async () => {
    const rec = record({ title: 'Old Title' });
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.title = 'New Title';
      await opts.submit(doc);
    });

    await make().run([rec.id], {});

    expect(patch).toHaveBeenCalledWith(`/knowledge/${rec.id}`, {
      title: 'New Title',
      expectedVersion: rec.version,
    });
  });

  it('sends expectedVersion alone (no other fields) and prints "no changes" when the document is untouched', async () => {
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

  it('rewrites a 409 conflict into a message telling the user to re-run', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    patch.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Record is at version 6, not 5'));

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.title = 'New Title';
      await opts.submit(doc);
    });

    await expect(make().run([rec.id], {})).rejects.toMatchObject({
      exitCode: 6,
    });
  });

  it('the 409 message tells the user to re-run, not the raw server message', async () => {
    const rec = record();
    get = jest.fn().mockResolvedValue(rec);
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    patch.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Record is at version 6, not 5'));

    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.title = 'New Title';
      await opts.submit(doc);
    });

    let caught: unknown;
    try {
      await make().run([rec.id], {});
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toMatch(/re-run/i);
  });

  // --- Task 5: key-backed fields resolve/reverse-map via the real
  // VocabularyIndex -- only `client.get`'s HTTP responses are stubbed.
  describe('key-backed fields', () => {
    const TYPE_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
    const OTHER_TYPE_ID = 'bbbbbbbb-2222-2222-2222-222222222222';

    function dispatchingGet(rec: KnowledgeRecord): jest.Mock {
      return jest.fn(async (url: string) => {
        if (url === `/knowledge/${rec.id}`) return rec;
        if (url === '/knowledge-vocabulary/types') {
          return [
            { id: TYPE_ID, key: 'howto', name: 'How-to' },
            { id: OTHER_TYPE_ID, key: 'reference', name: 'Reference' },
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
      expect(opts.initial).toContain('type: howto');
      expect(opts.initial.split('\n').some((l) => l.startsWith('typeId:'))).toBe(false);
    });

    it('an unchanged key-backed field is absent from the PATCH', async () => {
      const rec = record({ typeId: TYPE_ID });
      get = dispatchingGet(rec);
      clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        const doc = parseDocument(opts.initial);
        doc.fields.title = 'New Title';
        await opts.submit(doc);
      });

      await make().run([rec.id], {});

      expect(patch).toHaveBeenCalledWith(`/knowledge/${rec.id}`, {
        title: 'New Title',
        expectedVersion: rec.version,
      });
    });

    it('a changed key-backed field resolves to its id in the PATCH', async () => {
      const rec = record({ typeId: TYPE_ID });
      get = dispatchingGet(rec);
      clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;

      editorRun.mockImplementation(async (opts: EditSessionOptions) => {
        const doc = parseDocument(opts.initial);
        doc.fields.type = 'reference';
        await opts.submit(doc);
      });

      await make().run([rec.id], {});

      expect(patch).toHaveBeenCalledWith(`/knowledge/${rec.id}`, {
        typeId: OTHER_TYPE_ID,
        expectedVersion: rec.version,
      });
    });

    it('an unknown key re-opens the real editor annotated (exit 2) instead of discarding the edit', async () => {
      const rec = record({ typeId: TYPE_ID });
      get = dispatchingGet(rec);
      clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
      patch.mockResolvedValue({ slug: 'existing-title' });

      const reads: string[] = [];
      let round = 0;
      const launch = async (_cmd: string, file: string): Promise<number> => {
        round += 1;
        reads.push(readFileSync(file, 'utf-8'));
        if (round === 1) {
          writeFileSync(file, reads[0].replace('type: howto', 'type: bogus'));
        } else {
          writeFileSync(file, reads[0].replace('type: howto', 'type: reference'));
        }
        return 0;
      };

      const realEditor = new EditorService({ launch, env: {} });
      await new KnowledgeEditCommand(settings, clients, realEditor).run([rec.id], {});

      expect(patch).toHaveBeenCalledTimes(1);
      expect(patch).toHaveBeenCalledWith(`/knowledge/${rec.id}`, {
        typeId: OTHER_TYPE_ID,
        expectedVersion: rec.version,
      });
      expect(reads[1]).toContain('✗ type:');
      expect(reads[1]).toContain('Unknown knowledge type key "bogus"');
    });
  });
});
