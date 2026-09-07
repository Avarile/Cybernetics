import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { CompaniesGetCommand } from './companies-get.command';
import type { CompanyRecord } from './companies.helpers';

function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Acme Corp',
    legalName: null,
    domain: 'acme.example',
    industry: null,
    size: null,
    website: null,
    phone: null,
    country: null,
    parentCompanyId: null,
    ownerUserId: null,
    status: 'active',
    description: null,
    taxNumber: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CompaniesGetCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const COMPANY_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new CompaniesGetCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue(company());
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

  it('fetches by id and prints the same document shape edit would open', async () => {
    await make().run([COMPANY_ID], {});

    expect(get).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`);
    expect(out.join('')).toContain('name: Acme Corp');
  });

  it('--json emits the raw record', async () => {
    const rec = company();
    get.mockResolvedValue(rec);

    await make().run([COMPANY_ID], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rec);
  });
});
