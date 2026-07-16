import { createTransport } from 'nodemailer';
import type { EmailMessage, SmtpConn } from '../email.types';

function buildTransport(conn: SmtpConn) {
  return createTransport({
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    auth: conn.username
      ? { user: conn.username, pass: conn.password ?? '' }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

/** Connect + EHLO/AUTH check. Throws on any failure. No mail is sent. */
export async function verifySmtp(conn: SmtpConn): Promise<void> {
  const transport = buildTransport(conn);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/** Send one message through the given connection. Throws on send failure. */
export async function sendMail(
  conn: SmtpConn,
  msg: EmailMessage,
): Promise<void> {
  const transport = buildTransport(conn);
  try {
    await transport.sendMail({
      from: conn.fromName
        ? `${conn.fromName} <${conn.fromAddress}>`
        : conn.fromAddress,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  } finally {
    transport.close();
  }
}
