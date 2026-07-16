// The mock factory below must be self-contained (no references to outer
// `const`/`let` bindings): @swc/jest hoists `require('./smtp.transport')`
// (and transitively `require('nodemailer')`) above this file's own
// top-level statements, so any outer variable referenced inside the
// factory would still be in its TDZ when the factory runs. Same pattern
// as src/features/system/smtp-config.service.spec.ts.
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

import { createTransport } from 'nodemailer';
import { sendMail, verifySmtp } from './smtp.transport';
import type { SmtpConn } from '../email.types';

const mockCreateTransport = createTransport as jest.Mock;
const verify = jest.fn(async () => true);
const sendMailFn = jest.fn(async () => ({ messageId: 'x' }));
const close = jest.fn();
mockCreateTransport.mockReturnValue({ verify, sendMail: sendMailFn, close });

const conn: SmtpConn = {
  host: 'smtp.example.com',
  port: 587,
  secure: true,
  username: 'mailer',
  password: 'pass',
  fromAddress: 'no-reply@example.com',
  fromName: 'Cybernetics',
};

describe('smtp.transport', () => {
  beforeEach(() => {
    mockCreateTransport.mockClear();
    verify.mockClear();
    sendMailFn.mockClear();
    close.mockClear();
  });

  it('verifySmtp builds a transport with auth and calls verify', async () => {
    await verifySmtp(conn);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        auth: { user: 'mailer', pass: 'pass' },
      }),
    );
    expect(verify).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('verifySmtp omits auth when there is no username', async () => {
    await verifySmtp({ ...conn, username: null, password: null });
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it('sendMail formats the from header and passes text + html + cc', async () => {
    await sendMail(conn, {
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body',
      html: '<p>body</p>',
      cc: 'cc@example.com',
    });
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Cybernetics <no-reply@example.com>',
        to: 'user@example.com',
        cc: 'cc@example.com',
        subject: 'Hi',
        text: 'body',
        html: '<p>body</p>',
      }),
    );
    expect(close).toHaveBeenCalled();
  });

  it('sendMail uses a bare from address when fromName is null', async () => {
    await sendMail(
      { ...conn, fromName: null },
      {
        to: 'user@example.com',
        subject: 'Hi',
        text: 'body',
      },
    );
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'no-reply@example.com' }),
    );
  });
});
