import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { ProjectsMemberAddCommand } from './projects-member-add.command';

describe('ProjectsMemberAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ProjectsMemberAddCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    post = jest.fn().mockResolvedValue(null);
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

  it('resolves the project key and posts the member with the given flags', async () => {
    await make().run(['CYB'], { userId: 'bbbbbbbb-2222-2222-2222-222222222222', role: 'manager' });

    expect(post).toHaveBeenCalledWith('/projects/aaaaaaaa-1111-1111-1111-111111111111/members', {
      userId: 'bbbbbbbb-2222-2222-2222-222222222222',
      roleInProject: 'manager',
    });
    expect(out.join('')).toContain('manager');
  });

  it('omits roleInProject when --role is not given', async () => {
    await make().run(['CYB'], { userId: 'bbbbbbbb-2222-2222-2222-222222222222' });

    expect(post).toHaveBeenCalledWith('/projects/aaaaaaaa-1111-1111-1111-111111111111/members', {
      userId: 'bbbbbbbb-2222-2222-2222-222222222222',
    });
  });

  it('requires --user-id', async () => {
    await expect(make().run(['CYB'], {})).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('passes a well-formed UUID address straight through without a lookup call', async () => {
    await make().run(['dddddddd-4444-4444-4444-444444444444'], { userId: 'bbbbbbbb-2222-2222-2222-222222222222' });

    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/projects/dddddddd-4444-4444-4444-444444444444/members', {
      userId: 'bbbbbbbb-2222-2222-2222-222222222222',
    });
  });
});
