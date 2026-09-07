import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import {
  ContactsCategoryAddCommand,
  ContactsCategoryEditCommand,
  ContactsCategoryLsCommand,
  ContactsCategoryRmCommand,
} from './contacts-category.command';

// One test per verb proving this group's parameterised commands target
// `/contact-vocabulary/categories` — not `/contact-vocabulary/types` or a
// knowledge path. See `contacts-type.command.spec.ts` for the sibling proof.
const BASE_PATH = '/contact-vocabulary/categories';

const settings = {
  resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
} as unknown as SettingsService;

const ROW = {
  id: 'aaaaaaaa-1111-1111-1111-111111111111',
  key: 'enterprise',
  name: 'Enterprise',
  description: null,
  parentId: null,
  path: '/enterprise',
  depth: 0,
  sortOrder: 0,
  isSystem: false,
};

describe('ContactsCategoryLsCommand', () => {
  it('GETs /contact-vocabulary/categories', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const clients = { create: () => ({ get }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new ContactsCategoryLsCommand(settings, clients).run([], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    jest.restoreAllMocks();
  });
});

describe('ContactsCategoryAddCommand', () => {
  it('POSTs /contact-vocabulary/categories', async () => {
    const post = jest.fn().mockResolvedValue(ROW);
    const clients = { create: () => ({ post }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new ContactsCategoryAddCommand(settings, clients).run([], { key: 'enterprise', name: 'Enterprise' });

    expect(post).toHaveBeenCalledWith(BASE_PATH, { key: 'enterprise', name: 'Enterprise' });
    jest.restoreAllMocks();
  });
});

describe('ContactsCategoryEditCommand', () => {
  it('PATCHes /contact-vocabulary/categories/:id', async () => {
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

    await new ContactsCategoryEditCommand(settings, clients, editor).run([ROW.id], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    expect(patch).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`, { name: 'Renamed' });
    jest.restoreAllMocks();
  });
});

describe('ContactsCategoryRmCommand', () => {
  it('DELETEs /contact-vocabulary/categories/:id', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const del = jest.fn().mockResolvedValue(undefined);
    const clients = { create: () => ({ get, del }) } as unknown as ClientFactory;
    const confirmPrompt = jest.fn().mockResolvedValue(true);
    const isTTY = jest.fn().mockReturnValue(true);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new ContactsCategoryRmCommand(settings, clients, confirmPrompt, isTTY).run([ROW.id], { yes: true });

    expect(del).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`);
    jest.restoreAllMocks();
  });
});
