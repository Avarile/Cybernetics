import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { ContactsChannelLsCommand } from './contacts-channel-ls.command';
import type { ContactChannelRecord } from './contacts.helpers';

const CONTACT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

function channel(overrides: Partial<ContactChannelRecord> = {}): ContactChannelRecord {
  return {
    id: 'cccccccc-3333-3333-3333-333333333333',
    contactId: CONTACT_ID,
    kind: 'phone',
    value: '+1 555 0100',
    label: null,
    isPrimary: false,
    isVerified: false,
    optedOutAt: null,
    ...overrides,
  };
}

describe('ContactsChannelLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ContactsChannelLsCommand(settings, clients);

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

  it('resolves the address, then renders a table with the full channel id, KIND, VALUE, LABEL, PRIMARY', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: CONTACT_ID, displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce([
        channel({ label: 'work', isPrimary: true }),
      ]);

    await make().run(['ada@example.com'], {});

    expect(get.mock.calls[1][0]).toBe(`/contacts/${CONTACT_ID}/channels`);
    const text = out.join('');
    // Full id, not a truncated one — this id gets retyped into `channel rm`.
    expect(text).toContain('cccccccc-3333-3333-3333-333333333333');
    expect(text).toContain('KIND');
    expect(text).toContain('phone');
    expect(text).toContain('VALUE');
    expect(text).toContain('+1 555 0100');
    expect(text).toContain('LABEL');
    expect(text).toContain('work');
    expect(text).toContain('PRIMARY');
  });

  it('marks the primary channel and leaves non-primary rows blank', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: CONTACT_ID, displayName: 'Ada', primaryEmail: null }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce([channel({ id: 'p1', isPrimary: true }), channel({ id: 'p2', isPrimary: false })]);

    await make().run(['ada@example.com'], {});

    const lines = out.join('').split('\n');
    const primaryLine = lines.find((l) => l.includes('p1'));
    const otherLine = lines.find((l) => l.includes('p2'));
    expect(primaryLine).toMatch(/\*/);
    expect(otherLine).not.toMatch(/\*/);
  });

  it('prints an empty-state message when the contact has no channels', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: CONTACT_ID, displayName: 'Ada', primaryEmail: null }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce([]);

    await make().run(['ada@example.com'], {});

    expect(out.join('')).toContain('No channels');
  });

  it('--json emits the raw array, unmodified', async () => {
    const channels = [channel()];
    get
      .mockResolvedValueOnce({ data: [{ id: CONTACT_ID, displayName: 'Ada', primaryEmail: null }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce(channels);

    await make().run(['ada@example.com'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(channels);
  });

  it('passes a well-formed UUID address straight through without a lookup call', async () => {
    get.mockResolvedValueOnce([channel()]);

    await make().run([CONTACT_ID], {});

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe(`/contacts/${CONTACT_ID}/channels`);
  });
});
