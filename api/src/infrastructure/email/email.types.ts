/** Resolved SMTP connection + sender identity (secret already decrypted). */
export interface SmtpConn {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
}

/** Resolved IMAP connection (secret already decrypted). */
export interface ImapConn {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
}

/** An outbound message. `html` is optional; `text` is always sent. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string;
}

/** Envelope-level summary of a mailbox message. */
export interface MailboxSummary {
  uid: number;
  from: string;
  subject: string;
  date: Date;
  seen: boolean;
}

/** A fully fetched + MIME-parsed message. */
export interface ParsedMessage extends MailboxSummary {
  to: string;
  text: string;
  html: string | null;
  attachments: {
    filename: string | null;
    contentType: string;
    size: number;
  }[];
}

/** Thrown when no active SMTP/IMAP profile exists. A domain error, not HTTP. */
export class NoActiveEmailConfigError extends Error {
  constructor(kind: 'SMTP' | 'IMAP') {
    super(`No active ${kind} configuration is set`);
    this.name = 'NoActiveEmailConfigError';
  }
}
