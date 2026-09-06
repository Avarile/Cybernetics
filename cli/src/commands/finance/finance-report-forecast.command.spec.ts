import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { FinanceReportForecastCommand } from './finance-report-forecast.command';
import type { ForecastEntry } from './finance.helpers';

describe('FinanceReportForecastCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceReportForecastCommand(settings, clients);

  const entries: ForecastEntry[] = [{ name: 'Rent', kind: 'expense', amount: '1200.0000', dueOn: '2026-02-01' }];

  beforeEach(() => {
    get = jest.fn().mockResolvedValue(entries);
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

  it('renders a table with the amount as a right-aligned decimal string', async () => {
    await make().run([], { from: '2026-01-01', to: '2026-03-01' });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('from=2026-01-01');
    expect(calledPath).toContain('to=2026-03-01');
    const text = out.join('');
    expect(text).toContain('Rent');
    expect(text).toContain('1200.0000');
    expect(text).toContain('2026-02-01');
  });

  it('prints an empty-state message when nothing is forecast', async () => {
    get.mockResolvedValue([]);

    await make().run([], { from: '2026-01-01', to: '2026-03-01' });

    expect(out.join('')).toContain('Nothing forecast');
  });

  it('--json emits the raw array, unmodified', async () => {
    await make().run([], { from: '2026-01-01', to: '2026-03-01', json: true });

    expect(JSON.parse(out.join(''))).toEqual(entries);
  });
});
