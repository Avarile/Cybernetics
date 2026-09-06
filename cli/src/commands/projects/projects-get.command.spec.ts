import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { ProjectsGetCommand } from './projects-get.command';
import type { ProjectRecord } from './projects.helpers';

function record(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    key: 'CYB',
    name: 'Cybernetics',
    description: null,
    status: 'active',
    priority: 'medium',
    visibility: 'private',
    ownerUserId: null,
    leadUserId: null,
    startDate: null,
    dueDate: null,
    progressPct: 0,
    tagIds: [],
    access: 'owner',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProjectsGetCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ProjectsGetCommand(settings, clients);

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

  it('resolves a project key via the list endpoint, then fetches and renders it as a document', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce(record());

    await make().run(['CYB'], {});

    expect(get.mock.calls[1][0]).toBe('/projects/aaaaaaaa-1111-1111-1111-111111111111');
    expect(out.join('')).toContain('name: Cybernetics');
  });

  it('passes a well-formed UUID straight through without a lookup call', async () => {
    get.mockResolvedValueOnce(record({ id: 'bbbbbbbb-2222-2222-2222-222222222222' }));

    await make().run(['bbbbbbbb-2222-2222-2222-222222222222'], {});

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/projects/bbbbbbbb-2222-2222-2222-222222222222');
  });

  it('--json emits the raw record', async () => {
    const rec = record();
    get.mockResolvedValueOnce(rec);

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rec);
  });

  it('exits 2, naming the domain, when nothing matches the key', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });

    await expect(make().run(['NOPE'], {})).rejects.toThrow(UsageError);
    await expect(make().run(['NOPE'], {})).rejects.toThrow(/project/);
  });

  it('exits 2 naming every candidate when the key is ambiguous', async () => {
    get.mockResolvedValue({
      data: [
        { id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics One' },
        { id: 'bbbbbbbb-2222-2222-2222-222222222222', key: 'CYB', name: 'Cybernetics Two' },
      ],
      total: 2,
      page: 1,
      limit: 100,
    });

    await expect(make().run(['CYB'], {})).rejects.toThrow(UsageError);
    await expect(make().run(['CYB'], {})).rejects.toThrow(/Ambiguous/);
  });
});
