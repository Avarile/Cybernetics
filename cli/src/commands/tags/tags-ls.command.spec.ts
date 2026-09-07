import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { TagsLsCommand } from './tags-ls.command';
import type { TagRecord } from './tags.helpers';

function tag(overrides: Partial<TagRecord> = {}): TagRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    key: 'security',
    label: 'Security',
    scope: 'contact',
    color: null,
    description: null,
    usageCount: 3,
    isSystem: false,
    ...overrides,
  };
}

describe('TagsLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new TagsLsCommand(settings, clients);

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

  it('renders a table with the full id, KEY, LABEL, SCOPE, USED', async () => {
    get.mockResolvedValue({ data: [tag()], total: 1, page: 1, limit: 20 });

    await make().run([], {});

    expect(get.mock.calls[0][0]).toBe('/tags');
    const text = out.join('');
    expect(text).toContain('aaaaaaaa-1111-1111-1111-111111111111');
    expect(text).toContain('KEY');
    expect(text).toContain('security');
    expect(text).toContain('LABEL');
    expect(text).toContain('Security');
    expect(text).toContain('SCOPE');
    expect(text).toContain('contact');
    expect(text).toContain('USED');
    expect(text).toContain('3');
  });

  it('passes --scope through as a query filter', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], { scope: 'contact' });

    expect(get.mock.calls[0][0]).toBe('/tags?scope=contact');
  });

  it('with no --scope, lists every scope (no filter sent)', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {});

    expect(get.mock.calls[0][0]).toBe('/tags');
  });

  it('prints an empty-state message when there are no tags', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {});

    expect(out.join('')).toContain('No tags.');
  });

  it('--json emits the raw envelope', async () => {
    const envelope = { data: [tag()], total: 1, page: 1, limit: 20 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces withheld rows beyond this page', async () => {
    get.mockResolvedValue({ data: [tag()], total: 5, page: 1, limit: 1 });

    await make().run([], {});

    expect(out.join('')).toContain('4 more record(s)');
  });

  it('--page and --limit are passed through as query params', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 2, limit: 5 });

    await make().run([], { page: 2, limit: 5 });

    expect(get.mock.calls[0][0]).toBe('/tags?page=2&limit=5');
  });
});
