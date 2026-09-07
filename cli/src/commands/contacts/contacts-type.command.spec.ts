import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import {
  ContactsTypeAddCommand,
  ContactsTypeEditCommand,
  ContactsTypeLsCommand,
  ContactsTypeRmCommand,
} from './contacts-type.command';

// One test per verb proving this group's parameterised commands target
// `/contact-vocabulary/types` — not, say, `/contact-vocabulary/categories`
// or a knowledge path. See `contacts-category.command.spec.ts`,
// `knowledge-type.command.spec.ts` and `knowledge-category.command.spec.ts`
// for the same proof on the other three groups.
const BASE_PATH = '/contact-vocabulary/types';

const settings = {
  resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
} as unknown as SettingsService;

const ROW = {
  id: 'aaaaaaaa-1111-1111-1111-111111111111',
  key: 'customer',
  name: 'Customer',
  description: null,
  color: null,
  sortOrder: 0,
  isSystem: false,
};

describe('ContactsTypeLsCommand', () => {
  it('GETs /contact-vocabulary/types', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const clients = { create: () => ({ get }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new ContactsTypeLsCommand(settings, clients).run([], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    jest.restoreAllMocks();
  });
});

describe('ContactsTypeAddCommand', () => {
  it('POSTs /contact-vocabulary/types', async () => {
    const post = jest.fn().mockResolvedValue(ROW);
    const clients = { create: () => ({ post }) } as unknown as ClientFactory;
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new ContactsTypeAddCommand(settings, clients).run([], { key: 'customer', name: 'Customer' });

    expect(post).toHaveBeenCalledWith(BASE_PATH, { key: 'customer', name: 'Customer' });
    jest.restoreAllMocks();
  });
});

describe('ContactsTypeEditCommand', () => {
  it('PATCHes /contact-vocabulary/types/:id', async () => {
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

    await new ContactsTypeEditCommand(settings, clients, editor).run([ROW.id], {});

    expect(get).toHaveBeenCalledWith(BASE_PATH);
    expect(patch).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`, { name: 'Renamed' });
    jest.restoreAllMocks();
  });
});

describe('ContactsTypeRmCommand', () => {
  it('DELETEs /contact-vocabulary/types/:id', async () => {
    const get = jest.fn().mockResolvedValue([ROW]);
    const del = jest.fn().mockResolvedValue(undefined);
    const clients = { create: () => ({ get, del }) } as unknown as ClientFactory;
    const confirmPrompt = jest.fn().mockResolvedValue(true);
    const isTTY = jest.fn().mockReturnValue(true);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await new ContactsTypeRmCommand(settings, clients, confirmPrompt, isTTY).run([ROW.id], { yes: true });

    expect(del).toHaveBeenCalledWith(`${BASE_PATH}/${ROW.id}`);
    jest.restoreAllMocks();
  });
});
