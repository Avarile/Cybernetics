import { Module } from '@nestjs/common';
import { CacheModule } from '../../infrastructure/cache/cache.module';
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
 * @Roles('admin') on each controller). DatabaseModule is global. CacheModule
 * is `@Global()` too, but its providers (`CACHE_MANAGER`) are only registered
 * once something imports it into the module graph — in the full app that's
 * AppModule, but module-subset test contexts (e2e) don't import AppModule, so
 * this module imports CacheModule directly to stay self-sufficient.
 */
@Module({
  imports: [CryptoModule, CacheModule],
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
    SmtpConfigService,
    IntegrationCredentialService,
    SystemSettingsService,
  ],
})
export class SystemModule {}
