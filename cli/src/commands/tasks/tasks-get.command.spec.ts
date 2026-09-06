import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { TasksGetCommand } from './tasks-get.command';
import type { TaskRecord } from './tasks.helpers';

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
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

describe('TasksGetCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new TasksGetCommand(settings, clients);

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

  it('resolves a KEY-NUMBER address via the project and task list endpoints, then fetches and renders it', async () => {
    get
      // lookupProjectByKey('CYB')
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      // page of /tasks?projectId=...
      .mockResolvedValueOnce({
        data: [{ id: 'eeeeeeee-5555-5555-5555-555555555555', number: 42, title: 'Ship the thing', projectId: 'aaaaaaaa-1111-1111-1111-111111111111' }],
        total: 1,
        page: 1,
        limit: 25,
      })
      // GET /tasks/{id}
      .mockResolvedValueOnce(record());

    await make().run(['CYB-42'], {});

    expect(get.mock.calls[2][0]).toBe('/tasks/eeeeeeee-5555-5555-5555-555555555555');
    expect(out.join('')).toContain('title: Ship the thing');
  });

  it('passes a well-formed UUID straight through without a lookup call', async () => {
    get.mockResolvedValueOnce(record({ id: 'bbbbbbbb-2222-2222-2222-222222222222' }));

    await make().run(['bbbbbbbb-2222-2222-2222-222222222222'], {});

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/tasks/bbbbbbbb-2222-2222-2222-222222222222');
  });

  it('--json emits the raw record', async () => {
    const rec = record();
    get.mockResolvedValueOnce(rec);

    await make().run(['eeeeeeee-5555-5555-5555-555555555555'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rec);
  });

  it('exits 2, naming the domain, when the project key does not match', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });

    await expect(make().run(['NOPE-1'], {})).rejects.toThrow(UsageError);
    await expect(make().run(['NOPE-1'], {})).rejects.toThrow(/project/);
  });

  it('exits 2 when the project matches but no task has that number', async () => {
    get
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 25 });

    await expect(make().run(['CYB-999'], {})).rejects.toThrow(UsageError);
  });
});
