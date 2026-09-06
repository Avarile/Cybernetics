import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { FinanceReportSummaryCommand } from './finance-report-summary.command';
import type { FinanceSummary } from './finance.helpers';

describe('FinanceReportSummaryCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceReportSummaryCommand(settings, clients);

  const summary: FinanceSummary = {
    from: '2026-01-01',
    to: '2026-01-31',
    income: '5000.0000',
    expense: '3200.5000',
    net: '1799.5000',
    byKind: [
      { kind: 'income', total: '5000.0000', count: 3 },
      { kind: 'expense', total: '3200.5000', count: 7 },
    ],
  };

  beforeEach(() => {
    get = jest.fn().mockResolvedValue(summary);
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

  it('requires --from and --to', async () => {
    await expect(make().run([], { to: '2026-01-31' })).rejects.toThrow(UsageError);
    await expect(make().run([], { from: '2026-01-01' })).rejects.toThrow(UsageError);
    expect(get).not.toHaveBeenCalled();
  });

  it('passes from/to/projectId through as query params', async () => {
    await make().run([], { from: '2026-01-01', to: '2026-01-31', projectId: 'proj-1' });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('from=2026-01-01');
    expect(calledPath).toContain('to=2026-01-31');
    expect(calledPath).toContain('projectId=proj-1');
  });

  it('prints income/expense/net verbatim as decimal strings', async () => {
    await make().run([], { from: '2026-01-01', to: '2026-01-31' });

    const text = out.join('');
    expect(text).toContain('5000.0000');
    expect(text).toContain('3200.5000');
    expect(text).toContain('1799.5000');
  });

  it('--json emits the raw object, unmodified', async () => {
    await make().run([], { from: '2026-01-01', to: '2026-01-31', json: true });

    expect(JSON.parse(out.join(''))).toEqual(summary);
  });
});
