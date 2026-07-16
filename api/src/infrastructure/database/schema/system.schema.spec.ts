import {
  credentialKind,
  imapConfigs,
  integrationCredentials,
  settingType,
  smtpConfigs,
  systemAuditLog,
  systemSettings,
} from './system.schema';

describe('system schema', () => {
  it('defines the credential_kind enum', () => {
    expect(credentialKind.enumValues).toEqual([
      'api_key',
      'oauth2',
      'basic',
      'bearer',
    ]);
  });

  it('defines the setting_type enum', () => {
    expect(settingType.enumValues).toEqual([
      'string',
      'number',
      'boolean',
      'json',
    ]);
  });

  it('exposes all system tables', () => {
    expect(smtpConfigs).toBeDefined();
    expect(imapConfigs).toBeDefined();
    expect(integrationCredentials).toBeDefined();
    expect(systemSettings).toBeDefined();
    expect(systemAuditLog).toBeDefined();
  });
});
