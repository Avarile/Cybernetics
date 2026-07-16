import { Injectable } from '@nestjs/common';
import { EmailConfigRepository } from './email-config.repository';
import {
  NoActiveEmailConfigError,
  type IngestMessage,
  type MailboxState,
  type MailboxSummary,
  type ParsedMessage,
} from './email.types';
import {
  fetchForIngest,
  fetchMessage,
  listMessages,
  listUidsSince,
  mailboxState,
  setSeen,
  verifyImap,
} from './transport/imap.transport';

/** Inbound IMAP operations over the active IMAP config. Infra only (no HTTP). */
@Injectable()
export class InboxService {
  constructor(private readonly config: EmailConfigRepository) {}

  private async conn() {
    const conn = await this.config.activeImap();
    if (!conn) throw new NoActiveEmailConfigError('IMAP');
    return conn;
  }

  async verifyActive(): Promise<void> {
    await verifyImap(await this.conn());
  }

  async list(opts?: {
    mailbox?: string;
    limit?: number;
    unseenOnly?: boolean;
  }): Promise<MailboxSummary[]> {
    return listMessages(await this.conn(), opts);
  }

  async fetch(uid: number, mailbox?: string): Promise<ParsedMessage | null> {
    return fetchMessage(await this.conn(), uid, mailbox);
  }

  async markSeen(uid: number, mailbox?: string): Promise<void> {
    await setSeen(await this.conn(), uid, true, mailbox);
  }

  async markUnseen(uid: number, mailbox?: string): Promise<void> {
    await setSeen(await this.conn(), uid, false, mailbox);
  }

  async mailboxState(mailbox?: string): Promise<MailboxState> {
    return mailboxState(await this.conn(), mailbox);
  }

  async listUidsSince(
    sinceUid: number,
    opts?: { mailbox?: string; limit?: number },
  ): Promise<number[]> {
    return listUidsSince(await this.conn(), sinceUid, opts);
  }

  async fetchForIngest(
    uid: number,
    mailbox?: string,
  ): Promise<IngestMessage | null> {
    return fetchForIngest(await this.conn(), uid, mailbox);
  }
}
