import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import {
  KnowledgeCategoryAddCommand,
  KnowledgeCategoryEditCommand,
  KnowledgeCategoryLsCommand,
  KnowledgeCategoryRmCommand,
} from './knowledge-category.command';

// One test per verb proving this group's parameterised commands target
// `/knowledge-vocabulary/categories` — not the knowledge type path or either
// contacts vocabulary path. See the sibling `*.command.spec.ts` files for
// the other three groups' proofs.
const BASE_PATH = '/knowledge-vocabulary/categories';

const settings = {
  resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
} as unknown as SettingsService;

const ROW = {
  id: 'aaaaaaaa-1111-1111-1111-111111111111',
  key: 'compliance',
  name: 'Compliance',
  description: null,
  parentId: null,
  path: '/compliance',
  depth: 0,
  sortOrder: 0,
  isSystem: false,
};

describe('KnowledgeCategoryLsCommand', () => {
  it('GETs /knowledge-vocabulary/categories', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const clients = { create: () => ({ get }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new KnowledgeCategoryLsCommand(settings, clients).run([], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    jest.restoreAllMocks();
  });
});

describe('KnowledgeCategoryAddCommand', () => {
  it('POSTs /knowledge-vocabulary/categories', async () => {
    const post = jest.fn().mockResolvedValue(ROW);
    const clients = { create: () => ({ post }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new KnowledgeCategoryAddCommand(settings, clients).run([], { key: 'compliance', name: 'Compliance' });

    expect(post).toHaveBeenCalledWith(BASE_PATH, { key: 'compliance', name: 'Compliance' });
    jest.restoreAllMocks();
  });
});

describe('KnowledgeCategoryEditCommand', () => {
  it('PATCHes /knowledge-vocabulary/categories/:id', async () => {
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

    await new KnowledgeCategoryEditCommand(settings, clients, editor).run([ROW.id], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    expect(patch).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`, { name: 'Renamed' });
    jest.restoreAllMocks();
  });
});

describe('KnowledgeCategoryRmCommand', () => {
  it('DELETEs /knowledge-vocabulary/categories/:id', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const del = jest.fn().mockResolvedValue(undefined);
    const clients = { create: () => ({ get, del }) } as unknown as ClientFactory;
    const confirmPrompt = jest.fn().mockResolvedValue(true);
    const isTTY = jest.fn().mockReturnValue(true);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new KnowledgeCategoryRmCommand(settings, clients, confirmPrompt, isTTY).run([ROW.id], { yes: true });

    expect(del).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`);
    jest.restoreAllMocks();
  });
});
