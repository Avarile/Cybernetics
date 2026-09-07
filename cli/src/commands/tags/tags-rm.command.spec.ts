import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { TagsRmCommand } from './tags-rm.command';

describe('TagsRmCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const TAG_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new TagsRmCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      id: TAG_ID,
      key: 'security',
      label: 'Security',
      scope: 'contact',
      color: null,
      description: null,
      usageCount: 0,
      isSystem: false,
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

  it('--yes removes without prompting', async () => {
    await make().run([TAG_ID], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(`/tags/${TAG_ID}`);
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run([TAG_ID], {})).rejects.toThrow(UsageError);
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation naming the tag, then deletes when confirmed', async () => {
    await make().run([TAG_ID], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(confirmPrompt.mock.calls[0][0]).toContain('Security');
    expect(del).toHaveBeenCalledWith(`/tags/${TAG_ID}`);
  });

  it('aborts without deleting when the user declines', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run([TAG_ID], {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });
});
