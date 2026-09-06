import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { FinanceRecurringLsCommand } from './finance-recurring-ls.command';
import type { RecurringTransactionRecord } from './finance.helpers';

function row(overrides: Partial<RecurringTransactionRecord> = {}): RecurringTransactionRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Rent',
    kind: 'expense',
    amount: '1200.0000',
    currency: 'USD',
    frequency: 'monthly',
    dayOfPeriod: 1,
    startDate: '2026-01-01',
    endDate: null,
    nextDueOn: '2026-02-01',
    lastGeneratedOn: '2026-01-01',
    accountId: null,
    categoryId: null,
    projectId: null,
    contactId: null,
    companyId: null,
    autoPost: false,
    isActive: true,
    description: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('FinanceRecurringLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceRecurringLsCommand(settings, clients);

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

  it('renders a table with the amount as a right-aligned decimal string', async () => {
    get.mockResolvedValue([row()]);

    await make().run([], {});

    expect(get).toHaveBeenCalledWith('/finance/recurring');
    const text = out.join('');
    expect(text).toContain('NAME');
    expect(text).toContain('Rent');
    expect(text).toContain('1200.0000');
    expect(text).toContain('monthly');
    expect(text).toContain('2026-02-01');
  });

  it('prints an empty-state message when there are none', async () => {
    get.mockResolvedValue([]);

    await make().run([], {});

    expect(out.join('')).toContain('No recurring');
  });

  it('--json emits the raw array, unmodified', async () => {
    const rows = [row()];
    get.mockResolvedValue(rows);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rows);
  });
});
