import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { FinanceBudgetsAtRiskCommand } from './finance-budgets-at-risk.command';
import type { BudgetAtRisk, BudgetRecord } from './finance.helpers';

function budget(overrides: Partial<BudgetRecord> = {}): BudgetRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Marketing Q1',
    projectId: null,
    categoryId: null,
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    amount: '5000.0000',
    currency: 'USD',
    spentAmount: '4500.0000',
    alertThresholdPct: 80,
    ownerUserId: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('FinanceBudgetsAtRiskCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceBudgetsAtRiskCommand(settings, clients);

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

  it('renders a table of at-risk budgets with used percent', async () => {
    const rows: BudgetAtRisk[] = [{ budget: budget(), usedPct: 90 }];
    get.mockResolvedValue(rows);

    await make().run([], {});

    expect(get).toHaveBeenCalledWith('/finance/budgets/at-risk');
    const text = out.join('');
    expect(text).toContain('NAME');
    expect(text).toContain('USED%');
    expect(text).toContain('Marketing Q1');
    expect(text).toContain('90');
    expect(text).toContain('4500.0000');
  });

  it('prints an empty-state message when nothing is at risk', async () => {
    get.mockResolvedValue([]);

    await make().run([], {});

    expect(out.join('')).toContain('No budgets at risk');
  });

  it('--json emits the raw array, unmodified', async () => {
    const rows: BudgetAtRisk[] = [{ budget: budget(), usedPct: 90 }];
    get.mockResolvedValue(rows);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rows);
  });
});
