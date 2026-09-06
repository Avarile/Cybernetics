import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { FinanceAccountsCommand, FinanceAccountsLsCommand } from './finance-accounts.command';
import type { FinancialAccountRecord } from './finance.helpers';

function row(overrides: Partial<FinancialAccountRecord> = {}): FinancialAccountRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Operating',
    kind: 'bank',
    currency: 'USD',
    openingBalance: '0.0000',
    currentBalance: '1250.5000',
    institution: null,
    accountRef: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('FinanceAccountsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceAccountsCommand(settings, clients);

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

  it('renders a table of accounts with the balance right-aligned, as a decimal string', async () => {
    get.mockResolvedValue([
      row({ name: 'Operating', currentBalance: '1250.5000' }),
      row({ id: 'bbbbbbbb-2222-2222-2222-222222222222', name: 'Payroll', currentBalance: '-40.0000' }),
    ]);

    await make().run([], {});

    expect(get).toHaveBeenCalledWith('/finance/accounts');
    const text = out.join('');
    expect(text).toContain('NAME');
    expect(text).toContain('BALANCE');
    expect(text).toContain('Operating');
    expect(text).toContain('1250.5000');
    expect(text).toContain('-40.0000');
  });

  it('prints an empty-state message when there are no accounts', async () => {
    get.mockResolvedValue([]);

    await make().run([], {});

    expect(out.join('')).toContain('No accounts');
  });

  it('--json emits the raw array, unmodified', async () => {
    const rows = [row()];
    get.mockResolvedValue(rows);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rows);
  });
});

describe('FinanceAccountsLsCommand (the "finance accounts ls" alias)', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  it('lists identically to the bare "finance accounts" action', async () => {
    const get = jest.fn().mockResolvedValue([row({ name: 'Operating' })]);
    const clients = { create: () => ({ get }) } as unknown as ClientFactory;
    const out: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });

    await new FinanceAccountsLsCommand(settings, clients).run([], {});

    expect(get).toHaveBeenCalledWith('/finance/accounts');
    expect(out.join('')).toContain('Operating');
    jest.restoreAllMocks();
  });
});
