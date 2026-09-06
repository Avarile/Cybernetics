import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { ProjectsLsCommand } from './projects-ls.command';
import type { ProjectRecord } from './projects.helpers';

function row(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
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

describe('ProjectsLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ProjectsLsCommand(settings, clients);

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

  it('renders a table with KEY, NAME, STATUS, DUE columns', async () => {
    get.mockResolvedValue({
      data: [row({ key: 'ACME', name: 'Acme Rollout', status: 'active', dueDate: '2026-12-01' })],
      total: 1,
      page: 1,
      limit: 20,
    });

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('KEY');
    expect(text).toContain('NAME');
    expect(text).toContain('STATUS');
    expect(text).toContain('DUE');
    expect(text).toContain('ACME');
    expect(text).toContain('Acme Rollout');
    expect(text).toContain('2026-12-01');
  });

  it('passes filters through as query params', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], { search: 'hello world', status: 'active', limit: 5, page: 2 });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('search=hello');
    expect(calledPath).toContain('status=active');
    expect(calledPath).toContain('limit=5');
    expect(calledPath).toContain('page=2');
  });

  it('prints an empty-state message when there are no projects', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {});

    expect(out.join('')).toContain('No projects');
  });

  it('--json emits the raw envelope, unmodified', async () => {
    const envelope = { data: [row()], total: 1, page: 1, limit: 20 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages rather than staying silent', async () => {
    get.mockResolvedValue({ data: [row()], total: 3, page: 1, limit: 1 });

    await make().run([], {});

    expect(out.join('')).toContain('2 more record');
  });
});
