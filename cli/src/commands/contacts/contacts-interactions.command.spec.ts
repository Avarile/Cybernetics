import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { ContactsInteractionsCommand } from './contacts-interactions.command';

describe('ContactsInteractionsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const CONTACT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ContactsInteractionsCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn();
    clients = { create: () => ({ get }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the address, then renders a paginated table', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: CONTACT_ID, displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'eeeeeeee-5555-5555-5555-555555555555',
            contactId: CONTACT_ID,
            kind: 'call',
            occurredAt: '2026-09-06T12:00:00.000Z',
            subject: 'Kickoff',
            body: null,
            direction: 'outbound',
            projectId: null,
            durationMinutes: 30,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

    await make().run(['ada@example.com'], {});

    expect(get.mock.calls[1][0]).toBe(`/contacts/${CONTACT_ID}/interactions`);
    const text = out.join('');
    expect(text).toContain('KIND');
    expect(text).toContain('call');
    expect(text).toContain('Kickoff');
  });

  it('passes --page and --limit through as query params', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: CONTACT_ID, displayName: 'Ada', primaryEmail: null }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce({ data: [], total: 0, page: 2, limit: 5 });

    await make().run(['ada@example.com'], { page: 2, limit: 5 });

    expect(get.mock.calls[1][0]).toBe(`/contacts/${CONTACT_ID}/interactions?page=2&limit=5`);
  });

  it('prints an empty-state message when there are no interactions', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: CONTACT_ID, displayName: 'Ada', primaryEmail: null }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 20 });

    await make().run(['ada@example.com'], {});

    expect(out.join('')).toContain('No interactions');
  });

  it('--json emits the raw envelope, unmodified', async () => {
    const envelope = { data: [], total: 0, page: 1, limit: 20 };
    get
      .mockResolvedValueOnce({ data: [{ id: CONTACT_ID, displayName: 'Ada', primaryEmail: null }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce(envelope);

    await make().run(['ada@example.com'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages rather than staying silent', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: CONTACT_ID, displayName: 'Ada', primaryEmail: null }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'eeeeeeee-5555-5555-5555-555555555555',
            contactId: CONTACT_ID,
            kind: 'call',
            occurredAt: '2026-09-06T12:00:00.000Z',
            subject: null,
            body: null,
            direction: null,
            projectId: null,
            durationMinutes: null,
          },
        ],
        total: 3,
        page: 1,
        limit: 1,
      });

    await make().run(['ada@example.com'], {});

    expect(out.join('')).toContain('2 more record');
  });
});
