import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { CompaniesLsCommand } from './companies-ls.command';
import type { CompanyRecord } from './companies.helpers';

function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Acme Corp',
    legalName: null,
    domain: 'acme.example',
    industry: 'Software',
    size: null,
    website: null,
    phone: null,
    country: 'US',
    parentCompanyId: null,
    ownerUserId: null,
    status: 'active',
    description: null,
    taxNumber: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CompaniesLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new CompaniesLsCommand(settings, clients);

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

  it('renders a table with the full id, NAME, DOMAIN, INDUSTRY, COUNTRY', async () => {
    get.mockResolvedValue({ data: [company()], total: 1, page: 1, limit: 20 });

    await make().run([], {});

    expect(get.mock.calls[0][0]).toBe('/companies');
    const text = out.join('');
    expect(text).toContain('aaaaaaaa-1111-1111-1111-111111111111');
    expect(text).toContain('NAME');
    expect(text).toContain('Acme Corp');
    expect(text).toContain('DOMAIN');
    expect(text).toContain('acme.example');
    expect(text).toContain('INDUSTRY');
    expect(text).toContain('Software');
    expect(text).toContain('COUNTRY');
    expect(text).toContain('US');
  });

  it('passes --search and --status through as query filters', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], { search: 'acme', status: 'active' });

    expect(get.mock.calls[0][0]).toBe('/companies?search=acme&status=active');
  });

  it('prints an empty-state message when there are no companies', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {});

    expect(out.join('')).toContain('No companies.');
  });

  it('--json emits the raw envelope', async () => {
    const envelope = { data: [company()], total: 1, page: 1, limit: 20 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces withheld rows beyond this page', async () => {
    get.mockResolvedValue({ data: [company()], total: 5, page: 1, limit: 1 });

    await make().run([], {});

    expect(out.join('')).toContain('4 more record(s)');
  });
});
