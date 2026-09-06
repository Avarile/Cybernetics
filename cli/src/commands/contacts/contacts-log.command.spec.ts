import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { ContactsLogCommand } from './contacts-log.command';

describe('ContactsLogCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const CONTACT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ContactsLogCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      data: [{ id: CONTACT_ID, displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    post = jest.fn().mockResolvedValue({
      id: 'eeeeeeee-5555-5555-5555-555555555555',
      contactId: CONTACT_ID,
      kind: 'call',
      occurredAt: '2026-09-06T12:00:00.000Z',
      subject: 'Kickoff',
      body: null,
      direction: 'outbound',
      projectId: null,
      durationMinutes: 30,
    });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the address and logs an interaction with the given flags', async () => {
    await make().run(['ada@example.com'], { kind: 'call', subject: 'Kickoff', durationMinutes: 30 });

    expect(post).toHaveBeenCalledWith(`/contacts/${CONTACT_ID}/interactions`, {
      kind: 'call',
      subject: 'Kickoff',
      durationMinutes: 30,
    });
    expect(out.join('')).toContain('call');
  });

  it('passes through direction, body, projectId and occurredAt when given', async () => {
    await make().run(['ada@example.com'], {
      kind: 'meeting',
      body: 'Discussed scope.',
      direction: 'internal',
      projectId: 'ffffffff-6666-6666-6666-666666666666',
      occurredAt: '2026-09-01',
    });

    expect(post).toHaveBeenCalledWith(`/contacts/${CONTACT_ID}/interactions`, {
      kind: 'meeting',
      body: 'Discussed scope.',
      direction: 'internal',
      projectId: 'ffffffff-6666-6666-6666-666666666666',
      occurredAt: '2026-09-01',
    });
  });

  it('requires --kind', async () => {
    await expect(make().run(['ada@example.com'], { subject: 'x' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });
});
