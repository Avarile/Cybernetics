import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';

/**
 * Email infrastructure: outbound SMTP (MailerService) and inbound IMAP
 * (InboxService). Depends only on infrastructure (DatabaseModule is @Global;
 * CryptoModule provides EncryptionService). Providers/exports are added in
 * Tasks 4–5.
 */
@Module({
  imports: [CryptoModule],
  providers: [],
  exports: [],
})
export class EmailModule {}
