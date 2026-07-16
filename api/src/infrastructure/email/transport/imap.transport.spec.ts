// Mock factories must be self-contained (no references to outer `const`/`let`
// bindings): @swc/jest hoists `require('./imap.transport')` (and transitively
// `require('imapflow')` / `require('mailparser')`) above this file's own
// top-level statements, so any outer variable referenced inside the factory
// would still be in its TDZ when the factory runs. Same pattern as
// src/infrastructure/email/transport/smtp.transport.spec.ts.
jest.mock('imapflow', () => ({ ImapFlow: jest.fn() }));
jest.mock('mailparser', () => ({ simpleParser: jest.fn() }));

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  fetchMessage,
  listMessages,
  setSeen,
  verifyImap,
} from './imap.transport';
import type { ImapConn } from '../email.types';

const ImapFlowMock = ImapFlow as unknown as jest.Mock;
const simpleParserMock = simpleParser as unknown as jest.Mock;

class FakeLock {
  release = jest.fn();
}

function makeClient(overrides: Record<string, any> = {}) {
  return {
    connect: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    close: jest.fn(),
    getMailboxLock: jest.fn(async () => new FakeLock()),
    fetch: jest.fn(),
    fetchOne: jest.fn(),
    search: jest.fn(async () => [] as number[]),
    messageFlagsAdd: jest.fn(async () => true),
    messageFlagsRemove: jest.fn(async () => true),
    ...overrides,
  };
}

let currentClient: any;

const conn: ImapConn = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  username: 'user',
  password: 'pass',
};

/** Build an async iterator over the given messages for client.fetch. */
async function* iter(messages: any[]) {
  for (const m of messages) yield m;
}

describe('imap.transport', () => {
  beforeEach(() => {
    ImapFlowMock.mockClear();
    simpleParserMock.mockReset();
    currentClient = makeClient();
    ImapFlowMock.mockReturnValue(currentClient);
  });

  it('verifyImap connects then logs out', async () => {
    await verifyImap(conn);
    expect(ImapFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
    expect(currentClient.connect).toHaveBeenCalled();
    expect(currentClient.logout).toHaveBeenCalled();
  });

  it('listMessages maps envelopes to summaries (newest first, limited)', async () => {
    const d1 = new Date('2020-01-01');
    const d2 = new Date('2020-01-02');
    currentClient.fetch.mockReturnValue(
      iter([
        {
          uid: 1,
          envelope: {
            subject: 'one',
            date: d1,
            from: [{ address: 'a@x.com' }],
          },
          flags: new Set(['\\Seen']),
        },
        {
          uid: 2,
          envelope: {
            subject: 'two',
            date: d2,
            from: [{ address: 'b@x.com' }],
          },
          flags: new Set(),
        },
      ]),
    );
    const res = await listMessages(conn, { limit: 1 });
    expect(currentClient.getMailboxLock).toHaveBeenCalledWith('INBOX');
    expect(res).toEqual([
      { uid: 2, from: 'b@x.com', subject: 'two', date: d2, seen: false },
    ]);
  });

  it('fetchMessage parses the raw source into a ParsedMessage', async () => {
    currentClient.fetchOne.mockResolvedValue({
      uid: 7,
      source: Buffer.from('raw'),
      flags: new Set(['\\Seen']),
    });
    simpleParserMock.mockResolvedValue({
      subject: 'Hello',
      from: { value: [{ address: 'a@x.com', name: 'A' }] },
      to: { text: 'me@x.com' },
      date: new Date('2020-05-05'),
      text: 'plain',
      html: '<p>rich</p>',
      attachments: [
        { filename: 'f.pdf', contentType: 'application/pdf', size: 10 },
      ],
    });
    const res = await fetchMessage(conn, 7);
    expect(currentClient.fetchOne).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ source: true }),
      { uid: true },
    );
    expect(res).toEqual({
      uid: 7,
      from: 'a@x.com',
      to: 'me@x.com',
      subject: 'Hello',
      date: new Date('2020-05-05'),
      seen: true,
      text: 'plain',
      html: '<p>rich</p>',
      attachments: [
        { filename: 'f.pdf', contentType: 'application/pdf', size: 10 },
      ],
    });
  });

  it('fetchMessage returns null when the message is missing', async () => {
    currentClient.fetchOne.mockResolvedValue(false);
    expect(await fetchMessage(conn, 999)).toBeNull();
  });

  it('setSeen adds the \\Seen flag by UID', async () => {
    await setSeen(conn, 3, true);
    expect(currentClient.messageFlagsAdd).toHaveBeenCalledWith(3, ['\\Seen'], {
      uid: true,
    });
  });

  it('setSeen removes the \\Seen flag when value is false', async () => {
    await setSeen(conn, 3, false);
    expect(currentClient.messageFlagsRemove).toHaveBeenCalledWith(
      3,
      ['\\Seen'],
      { uid: true },
    );
  });
});
