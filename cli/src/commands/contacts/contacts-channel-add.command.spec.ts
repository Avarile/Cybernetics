import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { ContactsChannelAddCommand } from './contacts-channel-add.command';

describe('ContactsChannelAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ContactsChannelAddCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    post = jest.fn().mockResolvedValue({
      id: 'cccccccc-3333-3333-3333-333333333333',
      contactId: 'aaaaaaaa-1111-1111-1111-111111111111',
      kind: 'phone',
      value: '+1 555 0100',
      label: null,
      isPrimary: false,
      isVerified: false,
      optedOutAt: null,
    });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the address and posts a channel with the given flags', async () => {
    await make().run(['ada@example.com'], { kind: 'phone', value: '+1 555 0100' });

    expect(post).toHaveBeenCalledWith('/contacts/aaaaaaaa-1111-1111-1111-111111111111/channels', {
      kind: 'phone',
      value: '+1 555 0100',
    });
    expect(out.join('')).toContain('phone');
  });

  it('maps --primary to isPrimary and passes --label through', async () => {
    await make().run(['ada@example.com'], {
      kind: 'email',
      value: 'ada2@example.com',
      label: 'work',
      primary: true,
    });

    expect(post).toHaveBeenCalledWith('/contacts/aaaaaaaa-1111-1111-1111-111111111111/channels', {
      kind: 'email',
      value: 'ada2@example.com',
      label: 'work',
      isPrimary: true,
    });
  });

  it('requires --kind', async () => {
    await expect(make().run(['ada@example.com'], { value: 'x' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('requires --value', async () => {
    await expect(make().run(['ada@example.com'], { kind: 'phone' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('passes a well-formed UUID address straight through without a lookup call', async () => {
    await make().run(['bbbbbbbb-2222-2222-2222-222222222222'], { kind: 'phone', value: 'x' });

    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/contacts/bbbbbbbb-2222-2222-2222-222222222222/channels', {
      kind: 'phone',
      value: 'x',
    });
  });
});
