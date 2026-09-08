import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { ProjectsMemberLsCommand } from './projects-member-ls.command';
import type { ProjectMemberRecord } from './projects.helpers';

const PROJECT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

function member(overrides: Partial<ProjectMemberRecord> = {}): ProjectMemberRecord {
  return {
    id: 'cccccccc-3333-3333-3333-333333333333',
    projectId: PROJECT_ID,
    userId: 'bbbbbbbb-2222-2222-2222-222222222222',
    roleInProject: 'contributor',
    addedBy: null,
    joinedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProjectsMemberLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ProjectsMemberLsCommand(settings, clients);

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

  it('resolves the project key, then renders a table with the full user id, ROLE, ADDED', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: PROJECT_ID, key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce([member({ roleInProject: 'manager' })]);

    await make().run(['CYB'], {});

    expect(get.mock.calls[1][0]).toBe(`/projects/${PROJECT_ID}/members`);
    const text = out.join('');
    // Full id, not truncated — this id gets retyped into `member rm`.
    expect(text).toContain('bbbbbbbb-2222-2222-2222-222222222222');
    expect(text).toContain('ROLE');
    expect(text).toContain('manager');
    expect(text).toContain('ADDED');
    expect(text).toContain('2026-09-01T00:00:00.000Z');
  });

  it('prints an empty-state message when the project has no members', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: PROJECT_ID, key: 'CYB', name: 'Cybernetics' }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce([]);

    await make().run(['CYB'], {});

    expect(out.join('')).toContain('No members');
  });

  it('--json emits the raw array, unmodified', async () => {
    const members = [member()];
    get
      .mockResolvedValueOnce({ data: [{ id: PROJECT_ID, key: 'CYB', name: 'Cybernetics' }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce(members);

    await make().run(['CYB'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(members);
  });

  it('passes a well-formed UUID address straight through without a lookup call', async () => {
    get.mockResolvedValueOnce([member()]);

    await make().run([PROJECT_ID], {});

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe(`/projects/${PROJECT_ID}/members`);
  });
});
