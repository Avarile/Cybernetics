import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { FinanceReportIncomeCommand } from './finance-report-income.command';
import type { CategoryTotal } from './finance.helpers';

describe('FinanceReportIncomeCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceReportIncomeCommand(settings, clients);

  const totals: CategoryTotal[] = [
    { categoryId: 'cat-1', total: '5000.0000' },
    { categoryId: null, total: '250.0000' },
  ];

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

  it('requires --from and --to', async () => {
    await expect(make().run([], {})).rejects.toThrow(UsageError);
    expect(get).not.toHaveBeenCalled();
  });

  it('resolves categoryId to a name and marks null as uncategorized, amounts verbatim', async () => {
    get
      .mockResolvedValueOnce(totals)
      .mockResolvedValueOnce([{ id: 'cat-1', key: 'consulting', name: 'Consulting', kind: 'income', parentId: null, path: '/' }]);

    await make().run([], { from: '2026-01-01', to: '2026-01-31' });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('from=2026-01-01');
    expect(calledPath).toContain('to=2026-01-31');
    const text = out.join('');
    expect(text).toContain('Consulting');
    expect(text).toContain('uncategorized');
    expect(text).toContain('5000.0000');
    expect(text).toContain('250.0000');
    expect(text).not.toContain('cat-1');
  });

  it('--json emits the raw array, unmodified, without resolving category names', async () => {
    get.mockResolvedValueOnce(totals);

    await make().run([], { from: '2026-01-01', to: '2026-01-31', json: true });

    expect(get).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.join(''))).toEqual(totals);
  });
});
