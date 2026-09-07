import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import { TagsEditCommand } from './tags-edit.command';
import type { TagRecord } from './tags.helpers';

function tag(overrides: Partial<TagRecord> = {}): TagRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    key: 'security',
    label: 'Security',
    scope: 'contact',
    color: null,
    description: null,
    usageCount: 0,
    isSystem: false,
    ...overrides,
  };
}

describe('TagsEditCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const TAG_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new TagsEditCommand(settings, clients, editor);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue(tag());
    patch = jest.fn().mockResolvedValue(tag({ label: 'Renamed' }));
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

  it('fetches the tag by id and opens the editor pre-filled', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([TAG_ID], {});

    expect(get).toHaveBeenCalledWith(`/tags/${TAG_ID}`);
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toContain('label: Security');
  });

  it('sends only the field that changed, PATCHing /tags/:id', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.label = 'Renamed';
      await opts.submit(doc);
    });

    await make().run([TAG_ID], {});

    expect(patch).toHaveBeenCalledWith(`/tags/${TAG_ID}`, { label: 'Renamed' });
  });

  it('prints "No changes" and does not PATCH when the document is untouched', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      await opts.submit(doc);
    });

    await make().run([TAG_ID], {});

    expect(patch).not.toHaveBeenCalled();
    expect(out.join('')).toContain('No changes');
  });
});
