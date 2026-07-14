import { createTransport } from 'nodemailer';

export interface SmtpTestParams {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
}

/**
 * Opens a connection and runs SMTP verify (EHLO + AUTH when credentials are
 * present). Throws on any connectivity/auth failure. No mail is sent.
 */
export async function testSmtpConnection(p: SmtpTestParams): Promise<void> {
  const transport = createTransport({
    host: p.host,
    port: p.port,
    secure: p.secure,
    auth: p.username ? { user: p.username, pass: p.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
