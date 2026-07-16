import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../database/drizzle.constants';
import { imapConfigs, smtpConfigs } from '../database/schema/system.schema';
import { EncryptionService } from '../crypto/encryption.service';
import type { ImapConn, SmtpConn } from './email.types';

/**
 * Read-only resolver for the single active SMTP/IMAP profile. The write side
 * (CRUD) lives in the `system` feature; this reads the same tables for the
 * transport layer. Kept here so the email module never imports `system`.
 */
@Injectable()
export class EmailConfigRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly crypto: EncryptionService,
  ) {}

  async activeSmtp(): Promise<SmtpConn | null> {
    const rows = await this.db
      .select()
      .from(smtpConfigs)
      .where(
        and(eq(smtpConfigs.isActive, true), eq(smtpConfigs.isDeleted, false)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username ?? null,
      password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
      fromAddress: row.fromAddress,
      fromName: row.fromName ?? null,
    };
  }

  async activeImap(): Promise<ImapConn | null> {
    const rows = await this.db
      .select()
      .from(imapConfigs)
      .where(
        and(eq(imapConfigs.isActive, true), eq(imapConfigs.isDeleted, false)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username ?? null,
      password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
    };
  }
}
