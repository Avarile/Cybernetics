import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { TasksLsCommand } from './tasks-ls.command';
import type { TaskRecord } from './tasks.helpers';

function row(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'eeeeeeee-5555-5555-5555-555555555555',
    projectId: 'aaaaaaaa-1111-1111-1111-111111111111',
    milestoneId: null,
    parentTaskId: null,
    number: 42,
    title: 'Ship the thing',
    description: null,
    status: 'todo',
    priority: 'medium',
    assigneeUserId: null,
    reporterUserId: null,
    estimateMinutes: null,
    spentMinutes: 0,
    startDate: null,
    dueDate: null,
    completedAt: null,
    blockedReason: null,
    sortRank: null,
    externalRef: null,
    metadata: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('TasksLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new TasksLsCommand(settings, clients);

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

  it('renders a table with REF, TITLE, STATUS, PRIORITY, DUE columns, resolving REF via --project', async () => {
    get
      // AddressResolver.resolve('CYB', projectByKey)
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      // GET /tasks?projectId=...
      .mockResolvedValueOnce({
        data: [row({ number: 7, title: 'Fix the bug', status: 'in_progress', priority: 'high', dueDate: '2026-12-01' })],
        total: 1,
        page: 1,
        limit: 50,
      });

    await make().run([], { project: 'CYB' });

    const text = out.join('');
    expect(text).toContain('REF');
    expect(text).toContain('TITLE');
    expect(text).toContain('STATUS');
    expect(text).toContain('PRIORITY');
    expect(text).toContain('DUE');
    expect(text).not.toContain('ASSIGNEE');
    expect(text).toContain('CYB-7');
    expect(text).toContain('Fix the bug');
    expect(text).toContain('high');
    expect(text).toContain('2026-12-01');
    // Never a bare projectId in the human table.
    expect(text).not.toContain('aaaaaaaa-1111-1111-1111-111111111111');
  });

  it('resolves REF by looking up each distinct projectId when --project is not given', async () => {
    get
      // GET /tasks (no project filter)
      .mockResolvedValueOnce({
        data: [row({ number: 3, projectId: 'bbbbbbbb-2222-2222-2222-222222222222' })],
        total: 1,
        page: 1,
        limit: 50,
      })
      // GET /projects/bbbbbbbb-...
      .mockResolvedValueOnce({ key: 'ACME' });

    await make().run([], {});

    expect(get.mock.calls[1][0]).toBe('/projects/bbbbbbbb-2222-2222-2222-222222222222');
    expect(out.join('')).toContain('ACME-3');
  });

  it('--project resolves the key to projectId before querying', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], { project: 'CYB' });

    expect(get.mock.calls[1][0]).toContain('projectId=aaaaaaaa-1111-1111-1111-111111111111');
    expect(get.mock.calls[1][0]).not.toContain('project=CYB');
  });

  it('passes filters through as query params', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], {
      status: 'todo',
      assigneeUserId: 'user-1',
      milestoneId: 'ms-1',
      search: 'hello',
      limit: 5,
      page: 2,
    });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('status=todo');
    expect(calledPath).toContain('assigneeUserId=user-1');
    expect(calledPath).toContain('milestoneId=ms-1');
    expect(calledPath).toContain('search=hello');
    expect(calledPath).toContain('limit=5');
    expect(calledPath).toContain('page=2');
  });

  it('prints an empty-state message when there are no tasks', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], {});

    expect(out.join('')).toContain('No tasks');
  });

  it('--json emits the raw envelope, unmodified, without resolving any project keys', async () => {
    const envelope = { data: [row()], total: 1, page: 1, limit: 50 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(get).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages rather than staying silent', async () => {
    get.mockResolvedValueOnce({ data: [row()], total: 3, page: 1, limit: 1 }).mockResolvedValueOnce({ key: 'CYB' });

    await make().run([], {});

    expect(out.join('')).toContain('2 more record');
  });
});
