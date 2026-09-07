import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import {
  KnowledgeTypeAddCommand,
  KnowledgeTypeEditCommand,
  KnowledgeTypeLsCommand,
  KnowledgeTypeRmCommand,
} from './knowledge-type.command';

// One test per verb proving this group's parameterised commands target
// `/knowledge-vocabulary/types` — not a contacts path or the knowledge
// category path. See `knowledge-category.command.spec.ts` for the sibling
// proof, and `contacts-type.command.spec.ts`/`contacts-category.command.spec.ts`
// for the other two.
const BASE_PATH = '/knowledge-vocabulary/types';

const settings = {
  resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
} as unknown as SettingsService;

const ROW = {
  id: 'aaaaaaaa-1111-1111-1111-111111111111',
  key: 'policy',
  name: 'Policy',
  description: null,
  icon: null,
  color: null,
  defaultReviewIntervalDays: null,
  sortOrder: 0,
  isSystem: false,
};

describe('KnowledgeTypeLsCommand', () => {
  it('GETs /knowledge-vocabulary/types', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const clients = { create: () => ({ get }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new KnowledgeTypeLsCommand(settings, clients).run([], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    jest.restoreAllMocks();
  });
});

describe('KnowledgeTypeAddCommand', () => {
  it('POSTs /knowledge-vocabulary/types', async () => {
    const post = jest.fn().mockResolvedValue(ROW);
    const clients = { create: () => ({ post }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new KnowledgeTypeAddCommand(settings, clients).run([], { key: 'policy', name: 'Policy' });

    expect(post).toHaveBeenCalledWith(BASE_PATH, { key: 'policy', name: 'Policy' });
    jest.restoreAllMocks();
  });
});

describe('KnowledgeTypeEditCommand', () => {
  it('PATCHes /knowledge-vocabulary/types/:id', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const patch = jest.fn().mockResolvedValue(ROW);
    const clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
    const editorRun = jest.fn().mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.name = 'Renamed';
      await opts.submit(doc);
    });
    const editor = { run: editorRun } as unknown as EditorService;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new KnowledgeTypeEditCommand(settings, clients, editor).run([ROW.id], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    expect(patch).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`, { name: 'Renamed' });
    jest.restoreAllMocks();
  });
});

describe('KnowledgeTypeRmCommand', () => {
  it('DELETEs /knowledge-vocabulary/types/:id', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const del = jest.fn().mockResolvedValue(undefined);
    const clients = { create: () => ({ get, del }) } as unknown as ClientFactory;
    const confirmPrompt = jest.fn().mockResolvedValue(true);
    const isTTY = jest.fn().mockReturnValue(true);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new KnowledgeTypeRmCommand(settings, clients, confirmPrompt, isTTY).run([ROW.id], { yes: true });

    expect(del).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`);
    jest.restoreAllMocks();
  });
});
