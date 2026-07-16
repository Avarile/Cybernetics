import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AddressObject } from 'mailparser';
import type {
  ImapConn,
  IngestAttachment,
  IngestMessage,
  MailboxState,
  MailboxSummary,
  ParsedMessage,
} from '../email.types';

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

/** Probe a mailbox for its current UIDVALIDITY + UIDNEXT (no lock needed). */
export async function mailboxState(
  conn: ImapConn,
  mailbox = 'INBOX',
): Promise<MailboxState> {
  return withClient(conn, async (client) => {
    const status = await client.status(mailbox, {
      uidValidity: true,
      uidNext: true,
    });
    return {
      uidValidity: Number(status.uidValidity ?? 0),
      uidNext: Number(status.uidNext ?? 0),
    };
  });
}

/**
 * UIDs strictly greater than `sinceUid`, ascending, capped at `limit` (default
 * 200). The `${since+1}:*` range can echo the highest existing UID even when
 * none are newer (an IMAP quirk), so we filter `> sinceUid` defensively.
 */
export async function listUidsSince(
  conn: ImapConn,
  sinceUid: number,
  opts?: { mailbox?: string; limit?: number },
): Promise<number[]> {
  const mailbox = opts?.mailbox ?? 'INBOX';
  const limit = opts?.limit ?? 200;
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const found = await client.search(
        { uid: `${sinceUid + 1}:*` },
        { uid: true },
      );
      // `search` resolves to `number[] | false` (imapflow returns `false` if
      // the search itself failed) — `||`, not `??`, so the falsy `false`
      // case is also normalized to an empty array.
      const uids = (found || [])
        .filter((u) => u > sinceUid)
        .sort((a, b) => a - b);
      return uids.slice(0, limit);
    } finally {
      lock.release();
    }
  });
}

function toAddr(a: { address?: string; name?: string }): {
  address: string;
  name: string | null;
} {
  return { address: a.address ?? '', name: a.name ? a.name : null };
}

function addrList(
  addr: AddressObject | AddressObject[] | undefined,
): { address: string; name: string | null }[] {
  if (!addr) return [];
  const objs = Array.isArray(addr) ? addr : [addr];
  return objs.flatMap((o) => (o.value ?? []).map(toAddr));
}

/** Fetch one message's raw source + parsed fields + attachment buffers by UID. */
export async function fetchForIngest(
  conn: ImapConn,
  uid: number,
  mailbox = 'INBOX',
): Promise<IngestMessage | null> {
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        uid,
        { uid: true, source: true, flags: true, size: true },
        { uid: true },
      );
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      const from = parsed.from?.value?.[0];
      const attachments: IngestAttachment[] = parsed.attachments.map((a) => ({
        filename: a.filename ?? null,
        contentType: a.contentType,
        size: a.size,
        contentId: a.cid ?? null,
        inline: a.contentDisposition === 'inline' || Boolean(a.related),
        content: a.content,
      }));
      return {
        uid,
        raw: msg.source,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: parsed.references,
        from: from ? toAddr(from) : { address: '', name: null },
        to: addrList(parsed.to),
        cc: addrList(parsed.cc),
        subject: parsed.subject ?? '',
        sentAt: parsed.date ?? null,
        text: parsed.text ?? '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        seen: msg.flags?.has('\\Seen') ?? false,
        sizeBytes: Number(msg.size ?? msg.source.length),
        attachments,
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
