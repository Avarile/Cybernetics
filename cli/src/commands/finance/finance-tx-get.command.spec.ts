import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { FinanceTxGetCommand } from './finance-tx-get.command';
import type { TransactionRecord } from './finance.helpers';

function row(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: 'eeeeeeee-5555-5555-5555-555555555555',
    kind: 'expense',
    occurredOn: '2026-01-15',
    amount: '42.5000',
    currency: 'USD',
    baseAmount: null,
    fxRate: null,
    fxRateAt: null,
    accountId: 'aaaaaaaa-1111-1111-1111-111111111111',
    counterAccountId: null,
    categoryId: null,
    projectId: null,
    taskId: null,
    contactId: null,
    companyId: null,
    invoiceId: null,
    description: 'Office supplies',
    reference: null,
    receiptFileId: null,
    status: 'cleared',
    reversesTransactionId: null,
    recurringTransactionId: null,
    createdBy: null,
    metadata: {},
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('FinanceTxGetCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceTxGetCommand(settings, clients);

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

  it('fetches by id and prints the amount verbatim as a decimal string', async () => {
    get.mockResolvedValue(row({ amount: '42.5000' }));

    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], {});

    expect(get).toHaveBeenCalledWith('/finance/transactions/eeeeeeee-5555-5555-5555-555555555555');
    expect(out.join('')).toContain('42.5000');
    expect(out.join('')).toContain('Office supplies');
  });

  it('--json emits the raw record, unmodified', async () => {
    const record = row();
    get.mockResolvedValue(record);

    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(record);
  });
});
