import { ConfigStore, type CliConfig } from './config.store';
import { SettingsService } from './settings.service';

const CONFIG: CliConfig = {
  currentProfile: 'dev',
  profiles: {
    dev: { baseUrl: 'http://localhost:3000', email: 'dev@x.co' },
    prod: { baseUrl: 'https://api.example.com', email: 'me@x.co' },
  },
};

function make(env: NodeJS.ProcessEnv) {
  const config = { read: () => CONFIG } as unknown as ConfigStore;
  return new SettingsService(config, env);
}

describe('SettingsService', () => {
  it('uses the config file when nothing overrides it', () => {
    expect(make({}).resolve()).toEqual({
      profile: 'dev',
      baseUrl: 'http://localhost:3000',
      email: 'dev@x.co',
    });
  });

  it('lets CYB_PROFILE override the current profile', () => {
    expect(make({ CYB_PROFILE: 'prod' }).resolve().baseUrl).toBe(
      'https://api.example.com',
    );
  });

  it('lets a flag override CYB_PROFILE', () => {
    expect(
      make({ CYB_PROFILE: 'prod' }).resolve({ profile: 'dev' }).baseUrl,
    ).toBe('http://localhost:3000');
  });

  it('lets CYB_API_URL override the profile base URL', () => {
    expect(make({ CYB_API_URL: 'http://other:9000' }).resolve().baseUrl).toBe(
      'http://other:9000',
    );
  });

  it('lets the --api flag override CYB_API_URL', () => {
    expect(
      make({ CYB_API_URL: 'http://other:9000' }).resolve({ api: 'http://flag:1' })
        .baseUrl,
    ).toBe('http://flag:1');
  });

  it('strips a trailing slash so paths do not double up', () => {
    expect(make({}).resolve({ api: 'http://x:3000/' }).baseUrl).toBe('http://x:3000');
  });

  it('explains how to fix an unknown profile', () => {
    expect(() => make({}).resolve({ profile: 'nope' })).toThrow(
      /Unknown profile "nope".*cyb config profile add/s,
    );
  });

  it('explains how to fix a profile with no base URL', () => {
    const config = {
      read: () => ({ currentProfile: 'empty', profiles: { empty: {} } }),
    } as unknown as ConfigStore;
    expect(() => new SettingsService(config, {}).resolve()).toThrow(
      /No API URL for profile "empty"/,
    );
  });
});
