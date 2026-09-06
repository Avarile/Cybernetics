import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { ContactsGetCommand } from './contacts-get.command';
import type { ContactRecord } from './contacts.helpers';

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

describe('ContactsGetCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ContactsGetCommand(settings, clients);

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

  it('resolves an email/name via the list endpoint, then fetches and renders it as a document', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce(record());

    await make().run(['ada@example.com'], {});

    expect(get.mock.calls[1][0]).toBe('/contacts/aaaaaaaa-1111-1111-1111-111111111111');
    const text = out.join('');
    expect(text).toContain('displayName: Ada Lovelace');
  });

  it('passes a well-formed UUID straight through without a lookup call', async () => {
    get.mockResolvedValueOnce(record({ id: 'bbbbbbbb-2222-2222-2222-222222222222' }));

    await make().run(['bbbbbbbb-2222-2222-2222-222222222222'], {});

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/contacts/bbbbbbbb-2222-2222-2222-222222222222');
  });

  it('--json emits the raw record', async () => {
    const rec = record();
    get.mockResolvedValueOnce(rec);

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rec);
  });

  it('exits 2, naming the domain, when nothing matches the address', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });

    await expect(make().run(['nobody@example.com'], {})).rejects.toThrow(UsageError);
    await expect(make().run(['nobody@example.com'], {})).rejects.toThrow(/contact/);
  });

  it('exits 2 naming every candidate when the address is ambiguous', async () => {
    get.mockResolvedValue({
      data: [
        { id: 'aaaaaaaa-1111-1111-1111-111111111111', displayName: 'Sam A', primaryEmail: 'sam@example.com' },
        { id: 'bbbbbbbb-2222-2222-2222-222222222222', displayName: 'Sam B', primaryEmail: null },
      ],
      total: 2,
      page: 1,
      limit: 100,
    });

    await expect(make().run(['sam'], {})).rejects.toThrow(UsageError);
    await expect(make().run(['sam'], {})).rejects.toThrow(/Ambiguous/);
  });
});
