import { Module } from '@nestjs/common';
import { CacheModule } from '../../infrastructure/cache/cache.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { EmailModule } from '../../infrastructure/email/email.module';
import { SystemAuditModule } from './system-audit.module';
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
  imports: [CryptoModule, CacheModule, EmailModule, SystemAuditModule],
  controllers: [
    SystemAuditController,
    SmtpConfigController,
    ImapConfigController,
    IntegrationCredentialController,
    SystemSettingsController,
  ],
  providers: [
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
    // Re-exported as a module, not as a bare class: `SystemAuditService` is a
    // provider of SystemAuditModule, and Nest only lets a module export a token
    // it provides or a module it imports. Consumers of SystemModule still
    // resolve SystemAuditService, exactly as before.
    SystemAuditModule,
    SmtpConfigService,
    IntegrationCredentialService,
    SystemSettingsService,
  ],
})
export class SystemModule {}
