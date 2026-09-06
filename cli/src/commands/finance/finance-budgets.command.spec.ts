import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { FinanceBudgetsCommand, FinanceBudgetsLsCommand } from './finance-budgets.command';
import type { BudgetRecord } from './finance.helpers';

function row(overrides: Partial<BudgetRecord> = {}): BudgetRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Marketing Q1',
    projectId: null,
    categoryId: null,
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    amount: '5000.0000',
    currency: 'USD',
    spentAmount: '1200.0000',
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

describe('FinanceBudgetsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceBudgetsCommand(settings, clients);

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

  it('renders a table with amount/spent right-aligned decimal strings', async () => {
    get.mockResolvedValue({ rows: [row()], total: 1 });

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('NAME');
    expect(text).toContain('AMOUNT');
    expect(text).toContain('SPENT');
    expect(text).toContain('Marketing Q1');
    expect(text).toContain('5000.0000');
    expect(text).toContain('1200.0000');
  });

  it('passes projectId/page/limit through as query params', async () => {
    get.mockResolvedValue({ rows: [], total: 0 });

    await make().run([], { projectId: 'proj-1', page: 2, limit: 5 });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('projectId=proj-1');
    expect(calledPath).toContain('page=2');
    expect(calledPath).toContain('limit=5');
  });

  it('prints an empty-state message when there are no budgets', async () => {
    get.mockResolvedValue({ rows: [], total: 0 });

    await make().run([], {});

    expect(out.join('')).toContain('No budgets');
  });

  it('--json emits the raw { rows, total } envelope, unmodified', async () => {
    const envelope = { rows: [row()], total: 1 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages using the requested page/limit, since the envelope carries neither', async () => {
    get.mockResolvedValue({ rows: [row()], total: 3 });

    await make().run([], { limit: 1 });

    expect(out.join('')).toContain('2 more record');
  });
});

describe('FinanceBudgetsLsCommand (the "finance budgets ls" alias)', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  it('lists identically to the bare "finance budgets" action', async () => {
    const get = jest.fn().mockResolvedValue({ rows: [row({ name: 'Marketing Q1' })], total: 1 });
    const clients = { create: () => ({ get }) } as unknown as ClientFactory;
    const out: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });

    await new FinanceBudgetsLsCommand(settings, clients).run([], {});

    expect(out.join('')).toContain('Marketing Q1');
    jest.restoreAllMocks();
  });
});
