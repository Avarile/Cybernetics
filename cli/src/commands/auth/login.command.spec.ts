import type { SettingsService } from '../../core/config/settings.service';
import type { SessionService } from '../../core/session/session.service';
import { LoginCommand } from './login.command';

describe('LoginCommand', () => {
  const settings = {
    resolve: () => ({
      profile: 'dev',
      baseUrl: 'http://api.test',
      email: 'default@x.co',
    }),
  } as unknown as SettingsService;

  let session: { login: jest.Mock };
  let out: string[];

  const make = (password = 'pw') =>
    new LoginCommand(
      settings,
      session as unknown as SessionService,
      async () => password,
      (s: string) => out.push(s),
    );

  beforeEach(() => {
    session = { login: jest.fn().mockResolvedValue(undefined) };
    out = [];
  });

  it('logs in with the --email flag when given', async () => {
    await make().run([], { email: 'flag@x.co' });
    expect(session.login).toHaveBeenCalledWith(
      'dev',
      'http://api.test',
      'flag@x.co',
      'pw',
    );
  });

  it('falls back to the profile email when no flag is given', async () => {
    await make().run([], {});
    expect(session.login).toHaveBeenCalledWith(
      'dev',
      'http://api.test',
      'default@x.co',
      'pw',
    );
  });

  it('confirms which profile was signed into', async () => {
    await make().run([], {});
    expect(out.join('')).toContain('dev');
  });

  it('does not retry a rejected password', async () => {
    // POST /auth/login allows 5 attempts per minute; an automatic retry would
    // spend that budget and lock the user out.
    session.login.mockRejectedValue(new Error('AUTH_INVALID_CREDENTIALS'));
    await expect(make().run([], {})).rejects.toThrow();
    expect(session.login).toHaveBeenCalledTimes(1);
  });
});
