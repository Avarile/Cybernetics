import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { KnowledgeRmCommand } from './knowledge-rm.command';

describe('KnowledgeRmCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new KnowledgeRmCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      id: 'aaaaaaaa-1111-1111-1111-111111111111',
      slug: 'a-title',
      title: 'A Title',
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
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('/knowledge/aaaaaaaa-1111-1111-1111-111111111111');
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {})).rejects.toThrow(
      UsageError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation in a TTY session and deletes when confirmed', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/knowledge/aaaaaaaa-1111-1111-1111-111111111111');
  });

  it('aborts without deleting when the user declines', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });
});
