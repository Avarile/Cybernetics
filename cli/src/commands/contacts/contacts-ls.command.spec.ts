import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { ContactsLsCommand } from './contacts-ls.command';
import type { ContactRecord } from './contacts.helpers';

function row(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    displayName: 'Ada Lovelace',
    firstName: 'Ada',
    lastName: 'Lovelace',
    primaryEmail: 'ada@example.com',
    primaryPhone: '+1 555 0100',
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

describe('ContactsLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ContactsLsCommand(settings, clients);

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

  it('renders a table with NAME, EMAIL, PHONE, STATUS, TITLE columns', async () => {
    get.mockResolvedValue({
      data: [row({ displayName: 'Grace Hopper', primaryEmail: 'grace@navy.mil', jobTitle: 'Rear Admiral' })],
      total: 1,
      page: 1,
      limit: 20,
    });

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('NAME');
    expect(text).toContain('EMAIL');
    expect(text).toContain('PHONE');
    expect(text).toContain('STATUS');
    expect(text).toContain('TITLE');
    expect(text).not.toContain('COMPANY');
    expect(text).toContain('Grace Hopper');
    expect(text).toContain('grace@navy.mil');
    expect(text).toContain('Rear Admiral');
  });

  it('passes filters through as query params', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {
      search: 'hello world',
      status: 'active',
      typeId: 'type-1',
      categoryId: 'cat-1',
      companyId: 'co-1',
      tagId: 'tag-1',
      limit: 5,
      page: 2,
    });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('search=hello');
    expect(calledPath).toContain('status=active');
    expect(calledPath).toContain('typeId=type-1');
    expect(calledPath).toContain('categoryId=cat-1');
    expect(calledPath).toContain('companyId=co-1');
    expect(calledPath).toContain('tagId=tag-1');
    expect(calledPath).toContain('limit=5');
    expect(calledPath).toContain('page=2');
  });

  it('prints an empty-state message when there are no contacts', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {});

    expect(out.join('')).toContain('No contacts');
  });

  it('--json emits the raw envelope, unmodified', async () => {
    const envelope = { data: [row()], total: 1, page: 1, limit: 20 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages rather than staying silent', async () => {
    get.mockResolvedValue({ data: [row()], total: 3, page: 1, limit: 1 });

    await make().run([], {});

    expect(out.join('')).toContain('2 more record');
  });
});
