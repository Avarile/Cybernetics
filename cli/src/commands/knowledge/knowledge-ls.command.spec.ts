import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { KnowledgeLsCommand } from './knowledge-ls.command';
import type { KnowledgeRecord } from './knowledge.helpers';

function row(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    title: 'A Title',
    slug: 'a-title',
    summary: null,
    body: null,
    format: 'markdown',
    status: 'draft',
    visibility: 'private',
    version: 1,
    typeId: null,
    categoryId: null,
    ownerUserId: null,
    sourceUrl: null,
    sourceFileId: null,
    language: 'en',
    publishedAt: null,
    reviewDueAt: null,
    tagIds: [],
    access: 'manage',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('KnowledgeLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new KnowledgeLsCommand(settings, clients);

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

  it('renders a table with STATUS, TITLE, SLUG, UPDATED columns', async () => {
    get.mockResolvedValue({ data: [row({ status: 'published', title: 'My Doc', slug: 'my-doc' })], total: 1, page: 1, limit: 20 });

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('STATUS');
    expect(text).toContain('TITLE');
    expect(text).toContain('SLUG');
    expect(text).toContain('UPDATED');
    expect(text).toContain('published');
    expect(text).toContain('my-doc');
  });

  it('passes filters through as query params', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], { status: 'published', search: 'hello world', limit: 5, page: 2 });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('status=published');
    expect(calledPath).toContain('search=hello');
    expect(calledPath).toContain('limit=5');
    expect(calledPath).toContain('page=2');
  });

  it('prints an empty-state message when there are no records', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {});

    expect(out.join('')).toContain('No knowledge records');
  });

  it('--json emits the raw envelope, unmodified', async () => {
    const envelope = { data: [row()], total: 1, totalBeforeAccess: 1, page: 1, limit: 20 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows withheld by access control rather than staying silent', async () => {
    get.mockResolvedValue({ data: [row()], total: 1, totalBeforeAccess: 3, page: 1, limit: 20 });

    await make().run([], {});

    expect(out.join('')).toContain('withheld');
  });

  it("also announces ordinary pagination, same as every other domain's ls — computed against " +
    "totalBeforeAccess, since knowledge's own `total` is scoped to this page, not every page", async () => {
    // Real KnowledgeService.list semantics (knowledge.service.ts): `total` is
    // `visible.length` (always === data.length here), and the actual
    // across-all-pages count is `totalBeforeAccess`.
    get.mockResolvedValue({ data: [row()], total: 1, totalBeforeAccess: 5, page: 1, limit: 1 });

    await make().run([], {});

    expect(out.join('')).toContain('more record(s) beyond this page');
    expect(out.join('')).toContain('--page 2');
  });

  it('announces both facts together when more pages remain and this page is also access-filtered', async () => {
    // expectedOnPage = min(limit=2, totalBeforeAccess=5) = 2, but only 1 row
    // came back visible: 1 withheld. totalBeforeAccess=5 also means pages
    // remain beyond this one.
    get.mockResolvedValue({ data: [row()], total: 1, totalBeforeAccess: 5, page: 1, limit: 2 });

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('more record(s) beyond this page');
    expect(text).toContain('withheld');
  });
});
