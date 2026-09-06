import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { ContactsChannelRmCommand } from './contacts-channel-rm.command';

describe('ContactsChannelRmCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const CONTACT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
  const CHANNEL_ID = 'cccccccc-3333-3333-3333-333333333333';

  let get: jest.Mock;
  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new ContactsChannelRmCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue([
      { id: CHANNEL_ID, contactId: CONTACT_ID, kind: 'phone', value: '+1 555 0100', label: null, isPrimary: false, isVerified: false, optedOutAt: null },
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
    await make().run([CONTACT_ID, CHANNEL_ID], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(`/contacts/${CONTACT_ID}/channels/${CHANNEL_ID}`);
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run([CONTACT_ID, CHANNEL_ID], {})).rejects.toThrow(UsageError);
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation naming the channel, then deletes when confirmed', async () => {
    await make().run([CONTACT_ID, CHANNEL_ID], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    const message = confirmPrompt.mock.calls[0][0] as string;
    expect(message).toContain('phone');
    expect(message).toContain('+1 555 0100');
    expect(del).toHaveBeenCalledWith(`/contacts/${CONTACT_ID}/channels/${CHANNEL_ID}`);
  });

  it('aborts without deleting when the user declines', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run([CONTACT_ID, CHANNEL_ID], {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });

  it('exits 2 (not a crash) when the channel id does not belong to this contact', async () => {
    await expect(make().run([CONTACT_ID, 'dddddddd-4444-4444-4444-444444444444'], { yes: true })).rejects.toThrow(
      UsageError,
    );
    expect(del).not.toHaveBeenCalled();
  });
});
