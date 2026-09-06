import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError, UsageError } from '../../core/errors';
import { FinanceBudgetsAddCommand } from './finance-budgets-add.command';

describe('FinanceBudgetsAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new FinanceBudgetsAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Marketing Q1' });
    clients = { create: () => ({ post }) } as unknown as ClientFactory;
    editorRun = jest.fn();
    editor = { run: editorRun } as unknown as EditorService;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens the editor when no field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    expect((editorRun.mock.calls[0][0] as EditSessionOptions).initial).toContain('periodStart:');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], {
      name: 'Marketing Q1',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      amount: '5000.00',
      currency: 'USD',
    });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/finance/budgets', {
      name: 'Marketing Q1',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      amount: '5000.00',
      currency: 'USD',
    });
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires name/periodStart/periodEnd/amount/currency in flag mode, naming the real flags', async () => {
    const rejection: UsageError = await make()
      .run([], { name: 'X' })
      .catch((err) => err);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(rejection.message).toBe(
      'Missing required flag(s): --period-start, --period-end, --amount, --currency.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('maps optional flags through, including alertThresholdPct as a number', async () => {
    await make().run([], {
      name: 'Marketing Q1',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      amount: '5000.00',
      currency: 'USD',
      projectId: 'proj-1',
      categoryId: 'cat-1',
      alertThresholdPct: 90,
    });

    expect(post).toHaveBeenCalledWith('/finance/budgets', {
      name: 'Marketing Q1',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      amount: '5000.00',
      currency: 'USD',
      projectId: 'proj-1',
      categoryId: 'cat-1',
      alertThresholdPct: 90,
    });
  });

  it('a 400 with issues re-opens the buffer rather than crashing', async () => {
    const issue = { path: ['periodEnd'], message: 'The period ends before it starts' };
    post
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [issue]))
      .mockResolvedValueOnce({ id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Marketing Q1' });

    const reads: string[] = [];
    let round = 0;
    const launch = async (_cmd: string, file: string): Promise<number> => {
      round += 1;
      reads.push(readFileSync(file, 'utf-8'));
      if (round === 1) {
        writeFileSync(
          file,
          reads[0]
            .replace('\nname:', '\nname: Marketing Q1')
            .replace('\nperiodStart:', '\nperiodStart: 2026-03-31')
            .replace('\nperiodEnd:', '\nperiodEnd: 2026-01-01')
            .replace('\namount:', '\namount: 5000.00')
            .replace('\ncurrency:', '\ncurrency: USD'),
        );
      } else {
        writeFileSync(file, reads[1].replace('periodEnd: 2026-01-01', 'periodEnd: 2026-06-30'));
      }
      return 0;
    };

    const realEditor = new EditorService({ launch, env: {} });
    await new FinanceBudgetsAddCommand(settings, clients, realEditor).run([], {});

    expect(post).toHaveBeenCalledTimes(2);
    expect(reads[1]).toContain('The period ends before it starts');
    expect(out.join('')).toContain('Marketing Q1');
  });
});
