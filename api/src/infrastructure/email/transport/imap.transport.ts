import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AddressObject } from 'mailparser';
import type { ImapConn, MailboxSummary, ParsedMessage } from '../email.types';

function makeClient(conn: ImapConn): ImapFlow {
  return new ImapFlow({
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    auth: { user: conn.username ?? '', pass: conn.password ?? '' },
    logger: false,
  });
}

/** connect -> run fn -> always logout. */
async function withClient<T>(
  conn: ImapConn,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = makeClient(conn);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** connect + login smoke test. Throws on failure. */
export async function verifyImap(conn: ImapConn): Promise<void> {
  await withClient(conn, async () => undefined);
}

export async function listMessages(
  conn: ImapConn,
  opts?: { mailbox?: string; limit?: number; unseenOnly?: boolean },
): Promise<MailboxSummary[]> {
  const mailbox = opts?.mailbox ?? 'INBOX';
  const limit = opts?.limit ?? 50;
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const range = opts?.unseenOnly ? { seen: false } : '1:*';
      const out: MailboxSummary[] = [];
      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
      })) {
        out.push({
          uid: msg.uid,
          from: msg.envelope?.from?.[0]?.address ?? '',
          subject: msg.envelope?.subject ?? '',
          date: msg.envelope?.date ?? new Date(0),
          seen: msg.flags?.has('\\Seen') ?? false,
        });
      }
      // Newest last from the server; return newest first, capped at `limit`.
      if (limit <= 0) return [];
      return out.slice(-limit).reverse();
    } finally {
      lock.release();
    }
  });
}

/** Flattens mailparser's `to` (a single AddressObject or an array of them) to text. */
function addressText(
  addr: AddressObject | AddressObject[] | undefined,
): string {
  if (!addr) return '';
  return Array.isArray(addr) ? addr.map((a) => a.text).join(', ') : addr.text;
}

export async function fetchMessage(
  conn: ImapConn,
  uid: number,
  mailbox = 'INBOX',
): Promise<ParsedMessage | null> {
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        uid,
        { uid: true, source: true, flags: true },
        { uid: true },
      );
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      return {
        uid,
        from: parsed.from?.value?.[0]?.address ?? '',
        to: addressText(parsed.to),
        subject: parsed.subject ?? '',
        date: parsed.date ?? new Date(0),
        seen: msg.flags?.has('\\Seen') ?? false,
        text: parsed.text ?? '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        attachments: parsed.attachments.map((a) => ({
          filename: a.filename ?? null,
          contentType: a.contentType,
          size: a.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

export async function setSeen(
  conn: ImapConn,
  uid: number,
  value: boolean,
  mailbox = 'INBOX',
): Promise<void> {
  await withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (value) {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}
