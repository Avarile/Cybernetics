import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { KnowledgeGetCommand } from './knowledge-get.command';
import type { KnowledgeRecord } from './knowledge.helpers';

function record(overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    title: 'A Title',
    slug: 'a-title',
    summary: null,
    body: 'Body text.',
    format: 'markdown',
    status: 'draft',
    visibility: 'private',
    version: 2,
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

describe('KnowledgeGetCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new KnowledgeGetCommand(settings, clients);

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

  it('resolves a slug via the list endpoint, then fetches and renders it as a document', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', slug: 'a-title', title: 'A Title' }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce(record());

    await make().run(['a-title'], {});

    expect(get.mock.calls[1][0]).toBe('/knowledge/aaaaaaaa-1111-1111-1111-111111111111');
    const text = out.join('');
    expect(text).toContain('title: A Title');
    expect(text.trimEnd().endsWith('Body text.')).toBe(true);
  });

  it('passes a well-formed UUID straight through without a lookup call', async () => {
    get.mockResolvedValueOnce(record({ id: 'bbbbbbbb-2222-2222-2222-222222222222' }));

    await make().run(['bbbbbbbb-2222-2222-2222-222222222222'], {});

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/knowledge/bbbbbbbb-2222-2222-2222-222222222222');
  });

  it('--json emits the raw record', async () => {
    const rec = record();
    get.mockResolvedValueOnce(rec);

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rec);
  });

  it('exits 2, naming the domain, when nothing matches the address', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });

    await expect(make().run(['does-not-exist'], {})).rejects.toThrow(UsageError);
    await expect(make().run(['does-not-exist'], {})).rejects.toThrow(/knowledge/);
  });
});
