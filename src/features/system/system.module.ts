import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
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
  controllers: [SystemAuditController],
  providers: [SystemAuditRepository, SystemAuditService],
  exports: [SystemAuditService],
})
export class SystemModule {}
