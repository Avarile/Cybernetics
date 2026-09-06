import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { FinanceRecurringAddCommand } from './finance-recurring-add.command';

describe('FinanceRecurringAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new FinanceRecurringAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Rent' });
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
    expect((editorRun.mock.calls[0][0] as EditSessionOptions).initial).toContain('frequency:');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], {
      name: 'Rent',
      kind: 'expense',
      amount: '1200.00',
      currency: 'USD',
      frequency: 'monthly',
      startDate: '2026-01-01',
    });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/finance/recurring', {
      name: 'Rent',
      kind: 'expense',
      amount: '1200.00',
      currency: 'USD',
      frequency: 'monthly',
      startDate: '2026-01-01',
    });
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires name/kind/amount/currency/frequency/startDate in flag mode, naming the real flags', async () => {
    const rejection: UsageError = await make()
      .run([], { name: 'Rent' })
      .catch((err) => err);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(rejection.message).toBe(
      'Missing required flag(s): --kind, --amount, --currency, --frequency, --start-date.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('maps optional flags through, including autoPost as a boolean', async () => {
    await make().run([], {
      name: 'Rent',
      kind: 'expense',
      amount: '1200.00',
      currency: 'USD',
      frequency: 'monthly',
      startDate: '2026-01-01',
      dayOfPeriod: 1,
      endDate: '2026-12-31',
      accountId: 'acct-1',
      categoryId: 'cat-1',
      projectId: 'proj-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      autoPost: true,
      description: 'Monthly office rent',
    });

    expect(post).toHaveBeenCalledWith('/finance/recurring', {
      name: 'Rent',
      kind: 'expense',
      amount: '1200.00',
      currency: 'USD',
      frequency: 'monthly',
      startDate: '2026-01-01',
      dayOfPeriod: 1,
      endDate: '2026-12-31',
      accountId: 'acct-1',
      categoryId: 'cat-1',
      projectId: 'proj-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      autoPost: true,
      description: 'Monthly office rent',
    });
  });
});
