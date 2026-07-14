import * as net from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export interface ImapTestParams {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
}

/**
 * Minimal, dependency-free IMAP connectivity + auth check: connect (TLS when
 * `secure`), wait for the `* OK` greeting, issue a tagged LOGIN, and inspect the
 * tagged response. Resolves on `a1 OK`, rejects otherwise. Deliberately small —
 * swappable for a full IMAP client later.
 */
export async function testImapConnection(p: ImapTestParams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = p.secure
      ? tlsConnect({ host: p.host, port: p.port, servername: p.host })
      : net.connect({ host: p.host, port: p.port });

    const TAG = 'a1';
    let buffer = '';
    let sentLogin = false;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.write(`${TAG} LOGOUT\r\n`);
      } catch {
        // ignore
      }
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error('IMAP connection timed out')),
      10_000,
    );

    socket.setEncoding('utf8');
    socket.on('error', (err) => finish(err));
    socket.on('close', () => {
      if (!settled) finish(new Error('IMAP connection closed unexpectedly'));
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!sentLogin && buffer.includes('* OK')) {
        sentLogin = true;
        buffer = '';
        const user = (p.username ?? '').replace(/["\\]/g, '\\$&');
        const pass = (p.password ?? '').replace(/["\\]/g, '\\$&');
        socket.write(`${TAG} LOGIN "${user}" "${pass}"\r\n`);
        return;
      }
      if (sentLogin && buffer.includes(`${TAG} `)) {
        const ok = new RegExp(`${TAG} OK`, 'i').test(buffer);
        finish(ok ? undefined : new Error('IMAP login rejected'));
      }
    });
  });
}
