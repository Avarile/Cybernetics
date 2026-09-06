import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { ProjectsMemberRmCommand } from './projects-member-rm.command';

describe('ProjectsMemberRmCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const PROJECT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
  const USER_ID = 'bbbbbbbb-2222-2222-2222-222222222222';

  let get: jest.Mock;
  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new ProjectsMemberRmCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue([
      {
        id: 'cccccccc-3333-3333-3333-333333333333',
        projectId: PROJECT_ID,
        userId: USER_ID,
        roleInProject: 'contributor',
        addedBy: null,
        joinedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
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
    await make().run([PROJECT_ID, USER_ID], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/members/${USER_ID}`);
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run([PROJECT_ID, USER_ID], {})).rejects.toThrow(UsageError);
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation naming the role, then deletes when confirmed', async () => {
    await make().run([PROJECT_ID, USER_ID], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    const message = confirmPrompt.mock.calls[0][0] as string;
    expect(message).toContain('contributor');
    expect(del).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/members/${USER_ID}`);
  });

  it('aborts without deleting when the user declines', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run([PROJECT_ID, USER_ID], {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });

  it('exits 2 (not a crash) when the user id is not a member', async () => {
    await expect(make().run([PROJECT_ID, 'dddddddd-4444-4444-4444-444444444444'], { yes: true })).rejects.toThrow(
      UsageError,
    );
    expect(del).not.toHaveBeenCalled();
  });
});
