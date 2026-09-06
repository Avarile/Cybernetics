import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { FinanceReportSpendCommand } from './finance-report-spend.command';
import type { CategoryTotal } from './finance.helpers';

describe('FinanceReportSpendCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceReportSpendCommand(settings, clients);

  const totals: CategoryTotal[] = [{ categoryId: 'cat-2', total: '900.0000' }];

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

  it('hits the spend-by-category endpoint and resolves category names', async () => {
    get
      .mockResolvedValueOnce(totals)
      .mockResolvedValueOnce([{ id: 'cat-2', key: 'software', name: 'Software', kind: 'expense', parentId: null, path: '/' }]);

    await make().run([], { from: '2026-01-01', to: '2026-01-31' });

    expect(get.mock.calls[0][0]).toContain('/finance/reports/spend-by-category');
    const text = out.join('');
    expect(text).toContain('Software');
    expect(text).toContain('900.0000');
    expect(text).not.toContain('cat-2');
  });

  it('--json emits the raw array, unmodified', async () => {
    get.mockResolvedValueOnce(totals);

    await make().run([], { from: '2026-01-01', to: '2026-01-31', json: true });

    expect(JSON.parse(out.join(''))).toEqual(totals);
  });
});
