import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { FinanceTxReverseCommand } from './finance-tx-reverse.command';

describe('FinanceTxReverseCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new FinanceTxReverseCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      id: 'eeeeeeee-5555-5555-5555-555555555555',
      description: 'Office supplies',
      amount: '42.5000',
    });
    post = jest.fn().mockResolvedValue({
      id: 'ffffffff-6666-6666-6666-666666666666',
      description: 'Reversal of: Office supplies',
      amount: '42.5000',
    });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;
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

  it('--yes skips the confirmation prompt and posts the reversal', async () => {
    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/finance/transactions/eeeeeeee-5555-5555-5555-555555555555/reverse');
    expect(out.join('')).toContain('Reversal of: Office supplies');
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run(['eeeeeeee-5555-5555-5555-555555555555'], {})).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('prompts for confirmation on a TTY without --yes', async () => {
    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('aborts without posting when the prompt is declined', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], {});

    expect(post).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });
});
