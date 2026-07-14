import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { SmtpConfigController } from './smtp-config.controller';
import { SmtpConfigRepository } from './smtp-config.repository';
import { SmtpConfigService } from './smtp-config.service';
import { SystemAuditController } from './system-audit.controller';
import { SystemAuditRepository } from './system-audit.repository';
import { SystemAuditService } from './system-audit.service';

/**
 * System-records feature. Admin-only (enforced by the global RolesGuard via
 * @Roles('admin') on each controller). DatabaseModule + CacheModule are global,
 * so only CryptoModule needs importing.
 */
@Module({
  imports: [CryptoModule],
  controllers: [SystemAuditController, SmtpConfigController],
  providers: [
    SystemAuditRepository,
    SystemAuditService,
    SmtpConfigRepository,
    SmtpConfigService,
  ],
  exports: [SystemAuditService],
})
export class SystemModule {}
