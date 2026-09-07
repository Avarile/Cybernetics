import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import { UsageError } from '../../core/errors';
import {
  runVocabularyAdd,
  runVocabularyEdit,
  runVocabularyLs,
  runVocabularyRm,
  type VocabConfig,
  type VocabRecord,
} from './vocabulary-crud';

// A fake config, structurally identical to the four real ones (contact/knowledge
// type/category) but distinct, so these tests exercise the shared logic
// without depending on any one group's real endpoint or schema.
const FAKE_CONFIG: VocabConfig = {
  label: 'widget',
  basePath: '/fake-vocabulary/widgets',
  createSchema: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      sortOrder: { type: 'integer', default: 0 },
    },
    required: ['key', 'name'],
  },
  updateSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      sortOrder: { type: 'integer' },
    },
  },
};

function widget(overrides: Partial<VocabRecord> = {}): VocabRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    key: 'gadget',
    name: 'Gadget',
    description: null,
    ...overrides,
  };
}

const settings = {
  resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
} as unknown as SettingsService;

describe('runVocabularyLs', () => {
  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  beforeEach(() => {
    get = jest.fn();
    clients = { create: () => ({ get }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GETs the configured basePath and renders ID, KEY, NAME, DESCRIPTION', async () => {
    get.mockResolvedValue([widget({ description: 'a small gadget' })]);

    await runVocabularyLs(FAKE_CONFIG, settings, clients, {});

    expect(get).toHaveBeenCalledWith('/fake-vocabulary/widgets');
    const text = out.join('');
    expect(text).toContain('aaaaaaaa-1111-1111-1111-111111111111');
    expect(text).toContain('KEY');
    expect(text).toContain('gadget');
    expect(text).toContain('NAME');
    expect(text).toContain('Gadget');
    expect(text).toContain('DESCRIPTION');
    expect(text).toContain('a small gadget');
  });

  it('prints an empty-state message naming the label when there are none', async () => {
    get.mockResolvedValue([]);

    await runVocabularyLs(FAKE_CONFIG, settings, clients, {});

    expect(out.join('')).toContain('No widgets.');
  });

  it('--json emits the raw array, unmodified', async () => {
    const rows = [widget()];
    get.mockResolvedValue(rows);

    await runVocabularyLs(FAKE_CONFIG, settings, clients, { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rows);
  });
});

describe('runVocabularyAdd', () => {
  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  beforeEach(() => {
    post = jest.fn().mockResolvedValue(widget());
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

  it('creates from --key/--name/--description/--sort-order without opening the editor', async () => {
    await runVocabularyAdd(FAKE_CONFIG, settings, clients, editor, {
      key: 'gadget',
      name: 'Gadget',
      description: 'a small gadget',
      sortOrder: 5,
    });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/fake-vocabulary/widgets', {
      key: 'gadget',
      name: 'Gadget',
      description: 'a small gadget',
      sortOrder: 5,
    });
    expect(out.join('')).toContain('widget');
    expect(out.join('')).toContain('gadget');
  });

  it('opens the editor, built from the createSchema, when no field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await runVocabularyAdd(FAKE_CONFIG, settings, clients, editor, {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toContain('key:');
    expect(opts.initial).toContain('name:');
  });

  it('--no-edit without flags refuses rather than opening the editor', async () => {
    await expect(runVocabularyAdd(FAKE_CONFIG, settings, clients, editor, { edit: false })).rejects.toThrow(
      UsageError,
    );
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires --key when using flags', async () => {
    await expect(
      runVocabularyAdd(FAKE_CONFIG, settings, clients, editor, { name: 'Gadget', edit: false }),
    ).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('requires --name when using flags', async () => {
    await expect(
      runVocabularyAdd(FAKE_CONFIG, settings, clients, editor, { key: 'gadget', edit: false }),
    ).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('submitting the editor buffer posts the parsed fields', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { key: 'gadget', name: 'Gadget' }, body: '' });
    });

    await runVocabularyAdd(FAKE_CONFIG, settings, clients, editor, {});

    expect(post).toHaveBeenCalledWith('/fake-vocabulary/widgets', { key: 'gadget', name: 'Gadget' });
  });
});

describe('runVocabularyEdit', () => {
  const WIDGET_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  beforeEach(() => {
    get = jest.fn().mockResolvedValue([widget()]);
    patch = jest.fn().mockResolvedValue(widget({ name: 'Renamed' }));
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

  it('fetches the list, finds the id, and opens the editor pre-filled from the record', async () => {
    editorRun.mockResolvedValue(undefined);

    await runVocabularyEdit(FAKE_CONFIG, settings, clients, editor, WIDGET_ID, {});

    expect(get).toHaveBeenCalledWith('/fake-vocabulary/widgets');
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toContain('name: Gadget');
  });

  it('exits 2 when no record matches the given id', async () => {
    get.mockResolvedValue([]);

    await expect(runVocabularyEdit(FAKE_CONFIG, settings, clients, editor, WIDGET_ID, {})).rejects.toThrow(
      UsageError,
    );
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('sends only the field that changed, PATCHing basePath/:id', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.name = 'Renamed';
      await opts.submit(doc);
    });

    await runVocabularyEdit(FAKE_CONFIG, settings, clients, editor, WIDGET_ID, {});

    expect(patch).toHaveBeenCalledWith(`/fake-vocabulary/widgets/${WIDGET_ID}`, { name: 'Renamed' });
  });

  it('prints "No changes" and does not PATCH when the document is untouched', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      await opts.submit(doc);
    });

    await runVocabularyEdit(FAKE_CONFIG, settings, clients, editor, WIDGET_ID, {});

    expect(patch).not.toHaveBeenCalled();
    expect(out.join('')).toContain('No changes');
  });
});

describe('runVocabularyRm', () => {
  const WIDGET_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  beforeEach(() => {
    get = jest.fn().mockResolvedValue([widget()]);
    del = jest.fn().mockResolvedValue(undefined);
    clients = { create: () => ({ get, del }) } as unknown as ClientFactory;
    confirmPrompt = jest.fn().mockResolvedValue(true);
    isTTY = jest.fn().mockReturnValue(true);
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('--yes removes without prompting', async () => {
    await runVocabularyRm(FAKE_CONFIG, settings, clients, confirmPrompt, isTTY, WIDGET_ID, { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(`/fake-vocabulary/widgets/${WIDGET_ID}`);
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(
      runVocabularyRm(FAKE_CONFIG, settings, clients, confirmPrompt, isTTY, WIDGET_ID, {}),
    ).rejects.toThrow(UsageError);
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation naming the record, then deletes when confirmed', async () => {
    await runVocabularyRm(FAKE_CONFIG, settings, clients, confirmPrompt, isTTY, WIDGET_ID, {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(confirmPrompt.mock.calls[0][0]).toContain('Gadget');
    expect(del).toHaveBeenCalledWith(`/fake-vocabulary/widgets/${WIDGET_ID}`);
  });

  it('aborts without deleting when the user declines', async () => {
    confirmPrompt.mockResolvedValue(false);

    await runVocabularyRm(FAKE_CONFIG, settings, clients, confirmPrompt, isTTY, WIDGET_ID, {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });

  it('exits 2 when no record matches the given id', async () => {
    get.mockResolvedValue([]);

    await expect(
      runVocabularyRm(FAKE_CONFIG, settings, clients, confirmPrompt, isTTY, WIDGET_ID, { yes: true }),
    ).rejects.toThrow(UsageError);
    expect(del).not.toHaveBeenCalled();
  });
});
