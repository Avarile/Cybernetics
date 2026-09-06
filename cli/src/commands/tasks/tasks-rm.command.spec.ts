import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { TasksRmCommand } from './tasks-rm.command';

describe('TasksRmCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new TasksRmCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      id: 'eeeeeeee-5555-5555-5555-555555555555',
      title: 'Ship the thing',
    });
    del = jest.fn().mockResolvedValue(undefined);
    clients = { create: () => ({ get, del }) } as unknown as ClientFactory;
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

  it('--yes deletes without prompting', async () => {
    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('/tasks/eeeeeeee-5555-5555-5555-555555555555');
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run(['eeeeeeee-5555-5555-5555-555555555555'], {})).rejects.toThrow(
      UsageError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation in a TTY session and deletes when confirmed', async () => {
    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/tasks/eeeeeeee-5555-5555-5555-555555555555');
  });

  it('aborts without deleting when the user declines', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });
});
