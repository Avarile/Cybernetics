import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailboxConfig } from '../../config/configurations/mailbox.config';
import { InboxService } from '../../infrastructure/email/inbox.service';
import { FileService } from '../file-processor/file.service';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { SearchRecordService } from '../search-service/search-record.service';
import { INBOUND_EMAIL_COLLECTION } from './mailbox.constants';
import { MailboxRepository } from './mailbox.repository';
import type { NewEmailAttachmentRow } from '../../infrastructure/database/schema/mailbox.schema';
import type { IngestMessage } from '../../infrastructure/email/email.types';
import { computeThreadId, makeSnippet, normalizeReferences, toSearchDocument } from './mailbox.util';

@Injectable()
export class MailboxIngestService {
  private readonly logger = new Logger(MailboxIngestService.name);
  private readonly cfg: MailboxConfig;

  constructor(
    private readonly inbox: InboxService,
    private readonly repo: MailboxRepository,
    private readonly files: FileService,
    private readonly search: SearchRecordService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  async sync(
    accountId: string,
    mailbox: string,
  ): Promise<{ processed: number; batchWasFull: boolean }> {
    await this.repo.upsertSyncState(accountId, mailbox, {
      lastStatus: 'running',
      lastSyncStartedAt: new Date(),
      lastError: null,
    });

    let lastSeenUid = 0;
    try {
      const state = await this.repo.getSyncState(accountId, mailbox);
      const server = await this.inbox.mailboxState(mailbox);
      const uidValidityChanged =
        state?.uidValidity != null && state.uidValidity !== server.uidValidity;
      lastSeenUid = uidValidityChanged ? 0 : (state?.lastSeenUid ?? 0);

      const uids = await this.inbox.listUidsSince(lastSeenUid, {
        mailbox,
        limit: this.cfg.batchCap,
      });

      let processed = 0;
      for (const uid of uids) {
        const already = await this.repo.findByUid(
          accountId,
          mailbox,
          server.uidValidity,
          uid,
        );
        if (!already) {
          const msg = await this.inbox.fetchForIngest(uid, mailbox);
          if (msg) {
            await this.persist(accountId, mailbox, server.uidValidity, msg);
            processed++;
          }
        }
        lastSeenUid = uid;
      }

      await this.repo.upsertSyncState(accountId, mailbox, {
        uidValidity: server.uidValidity,
        lastSeenUid,
        lastStatus: 'ok',
        lastSyncFinishedAt: new Date(),
        lastError: null,
      });
      return { processed, batchWasFull: uids.length >= this.cfg.batchCap };
    } catch (error) {
      await this.repo.upsertSyncState(accountId, mailbox, {
        lastSeenUid,
        lastStatus: 'error',
        lastSyncFinishedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async persist(
    accountId: string,
    mailbox: string,
    uidValidity: number,
    msg: IngestMessage,
  ): Promise<void> {
    let rawFileId: string | null = null;
    if (this.cfg.storeRaw) {
      const raw = await this.files.putFromStream(
        msg.raw,
        {
          filename: `${msg.uid}.eml`,
          mimeType: 'message/rfc822',
          size: msg.raw.length,
          allowAnyMime: true,
          metadata: { kind: 'inbound-email-raw' },
        },
        SYSTEM_PRINCIPAL,
      );
      rawFileId = raw.id;
    }

    const attachmentRows: Omit<NewEmailAttachmentRow, 'emailId'>[] = [];
    for (const att of msg.attachments) {
      try {
        const file = await this.files.putFromStream(
          att.content,
          {
            filename: att.filename ?? 'attachment',
            mimeType: att.contentType,
            size: att.size,
            allowAnyMime: true,
            metadata: { kind: 'inbound-email-attachment' },
          },
          SYSTEM_PRINCIPAL,
        );
        attachmentRows.push({
          fileId: file.id,
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          contentId: att.contentId,
          inline: att.inline,
        });
      } catch (error) {
        this.logger.warn(
          `Skipped attachment "${att.filename ?? 'attachment'}" (uid ${msg.uid}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const references = normalizeReferences(msg.references);
    const row = await this.repo.insertMessageWithAttachments(
      {
        accountId,
        mailbox,
        uid: msg.uid,
        uidValidity,
        messageId: msg.messageId,
        inReplyTo: msg.inReplyTo,
        references,
        threadId: computeThreadId(
          references,
          msg.inReplyTo,
          msg.messageId,
          `${accountId}:${mailbox}:${uidValidity}:${msg.uid}`,
        ),
        fromAddress: msg.from.address,
        fromName: msg.from.name,
        toAddresses: msg.to.map((a) => ({ address: a.address, name: a.name })),
        ccAddresses: msg.cc.map((a) => ({ address: a.address, name: a.name })),
        subject: msg.subject,
        sentAt: msg.sentAt,
        receivedAt: msg.sentAt ?? new Date(),
        snippet: makeSnippet(msg.text),
        bodyText: msg.text,
        bodyHtml: msg.html,
        sizeBytes: msg.sizeBytes,
        seen: msg.seen,
        hasAttachments: attachmentRows.length > 0,
        rawFileId,
      },
      attachmentRows,
    );

    await this.search.persist(INBOUND_EMAIL_COLLECTION, [
      { externalId: row.id, document: toSearchDocument(row) },
    ]);
  }
}
