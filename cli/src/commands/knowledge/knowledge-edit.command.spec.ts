import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError } from '../../core/errors';
import { KnowledgeEditCommand } from './knowledge-edit.command';
import { buildKnowledgeDocument, type KnowledgeRecord } from './knowledge.helpers';
import { parseDocument } from '../../core/editor/frontmatter';

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
    expect(opts.initial).toBe(buildKnowledgeDocument(rec));
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
});
