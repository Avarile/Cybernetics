import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { ImapConfigController } from './imap-config.controller';
import { ImapConfigRepository } from './imap-config.repository';
import { ImapConfigService } from './imap-config.service';
import { IntegrationCredentialController } from './integration-credential.controller';
import { IntegrationCredentialRepository } from './integration-credential.repository';
import { IntegrationCredentialService } from './integration-credential.service';
import { SmtpConfigController } from './smtp-config.controller';
import { SmtpConfigRepository } from './smtp-config.repository';
import { SmtpConfigService } from './smtp-config.service';
import { SystemAuditController } from './system-audit.controller';
import { SystemAuditRepository } from './system-audit.repository';
import { SystemAuditService } from './system-audit.service';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsRepository } from './system-settings.repository';
import { SystemSettingsService } from './system-settings.service';

/**
 * System-records feature. Admin-only (enforced by the global RolesGuard via
 * @Roles('admin') on each controller). DatabaseModule + CacheModule are global,
 * so only CryptoModule needs importing.
 */
@Module({
  imports: [CryptoModule],
  controllers: [
    SystemAuditController,
    SmtpConfigController,
    ImapConfigController,
    IntegrationCredentialController,
    SystemSettingsController,
  ],
  providers: [
    SystemAuditRepository,
    SystemAuditService,
    SmtpConfigRepository,
    SmtpConfigService,
    ImapConfigRepository,
    ImapConfigService,
    IntegrationCredentialRepository,
    IntegrationCredentialService,
    SystemSettingsRepository,
    SystemSettingsService,
  ],
  exports: [
    SystemAuditService,
    IntegrationCredentialService,
    SystemSettingsService,
  ],
})
export class SystemModule {}
