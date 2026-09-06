import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { FinanceTxLsCommand } from './finance-tx-ls.command';
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

describe('FinanceTxLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceTxLsCommand(settings, clients);

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

  it('renders DATE, DESCRIPTION, AMOUNT (right-aligned decimal string), CURRENCY, STATUS, ACCOUNT', async () => {
    get
      .mockResolvedValueOnce({
        data: [row({ amount: '42.5000', description: 'Office supplies', accountId: 'aaaaaaaa-1111-1111-1111-111111111111' })],
        total: 1,
        page: 1,
        limit: 50,
      })
      // resolveAccountNames
      .mockResolvedValueOnce([{ id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Operating' }]);

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('DATE');
    expect(text).toContain('DESCRIPTION');
    expect(text).toContain('AMOUNT');
    expect(text).toContain('CURRENCY');
    expect(text).toContain('STATUS');
    expect(text).toContain('ACCOUNT');
    expect(text).toContain('2026-01-15');
    expect(text).toContain('Office supplies');
    // Rendered verbatim as a decimal string — never reformatted or coerced through a float.
    expect(text).toContain('42.5000');
    expect(text).toContain('Operating');
    expect(text).not.toContain('aaaaaaaa-1111-1111-1111-111111111111');
  });

  it('passes filters through as query params', async () => {
    get.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], {
      kind: 'expense',
      status: 'cleared',
      accountId: 'acct-1',
      categoryId: 'cat-1',
      projectId: 'proj-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      from: '2026-01-01',
      to: '2026-01-31',
      page: 2,
      limit: 5,
    });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('kind=expense');
    expect(calledPath).toContain('status=cleared');
    expect(calledPath).toContain('accountId=acct-1');
    expect(calledPath).toContain('categoryId=cat-1');
    expect(calledPath).toContain('projectId=proj-1');
    expect(calledPath).toContain('contactId=contact-1');
    expect(calledPath).toContain('companyId=company-1');
    expect(calledPath).toContain('from=2026-01-01');
    expect(calledPath).toContain('to=2026-01-31');
    expect(calledPath).toContain('page=2');
    expect(calledPath).toContain('limit=5');
  });

  it('prints an empty-state message when there are no transactions', async () => {
    get.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], {});

    expect(out.join('')).toContain('No transactions');
  });

  it('--json emits the raw envelope, unmodified, without resolving account names', async () => {
    const envelope = { data: [row()], total: 1, page: 1, limit: 50 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(get).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages rather than staying silent', async () => {
    get
      .mockResolvedValueOnce({ data: [row()], total: 3, page: 1, limit: 1 })
      .mockResolvedValueOnce([{ id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Operating' }]);

    await make().run([], {});

    expect(out.join('')).toContain('2 more record');
  });
});
