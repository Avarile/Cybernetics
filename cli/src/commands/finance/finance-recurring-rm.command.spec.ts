import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { FinanceRecurringRmCommand } from './finance-recurring-rm.command';

describe('FinanceRecurringRmCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new FinanceRecurringRmCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    del = jest.fn().mockResolvedValue(undefined);
    clients = { create: () => ({ del }) } as unknown as ClientFactory;
    confirmPrompt = jest.fn().mockResolvedValue(true);
    isTTY = jest.fn().mockReturnValue(true);
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('--yes skips the confirmation prompt and deletes', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('/finance/recurring/aaaaaaaa-1111-1111-1111-111111111111');
    expect(out.join('')).toContain('Stopped');
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {})).rejects.toThrow(UsageError);
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation on a TTY without --yes', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('aborts without deleting when the prompt is declined', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });
});
