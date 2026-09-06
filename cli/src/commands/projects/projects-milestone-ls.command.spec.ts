import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { ProjectsMilestoneLsCommand } from './projects-milestone-ls.command';
import type { MilestoneRecord } from './projects.helpers';

function milestone(overrides: Partial<MilestoneRecord> = {}): MilestoneRecord {
  return {
    id: 'cccccccc-3333-3333-3333-333333333333',
    projectId: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'Beta launch',
    description: null,
    status: 'pending',
    dueDate: null,
    reachedAt: null,
    ownerUserId: null,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('ProjectsMilestoneLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new ProjectsMilestoneLsCommand(settings, clients);

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

  it('resolves the project key, then renders a plain (unpaginated) table', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce([milestone({ name: 'Beta launch', dueDate: '2026-12-01' })]);

    await make().run(['CYB'], {});

    expect(get.mock.calls[1][0]).toBe('/projects/aaaaaaaa-1111-1111-1111-111111111111/milestones');
    const text = out.join('');
    expect(text).toContain('ID');
    expect(text).toContain('NAME');
    expect(text).toContain('STATUS');
    expect(text).toContain('DUE');
    expect(text).toContain('Beta launch');
    expect(text).toContain('2026-12-01');
    expect(text).toContain('cccccccc-3333-3333-3333-333333333333');
  });

  it('prints an empty-state message when there are no milestones', async () => {
    get
      .mockResolvedValueOnce({ data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce([]);

    await make().run(['CYB'], {});

    expect(out.join('')).toContain('No milestones');
  });

  it('--json emits the raw array, unmodified', async () => {
    const milestones = [milestone()];
    get
      .mockResolvedValueOnce({ data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }], total: 1, page: 1, limit: 100 })
      .mockResolvedValueOnce(milestones);

    await make().run(['CYB'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(milestones);
  });
});
