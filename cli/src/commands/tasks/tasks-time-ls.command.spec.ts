import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { TasksTimeLsCommand } from './tasks-time-ls.command';
import type { TimeEntryRecord } from './tasks-time-log.command';

function entry(overrides: Partial<TimeEntryRecord> = {}): TimeEntryRecord {
  return {
    id: 'ffffffff-6666-6666-6666-666666666666',
    taskId: 'eeeeeeee-5555-5555-5555-555555555555',
    projectId: 'aaaaaaaa-1111-1111-1111-111111111111',
    userId: 'bbbbbbbb-2222-2222-2222-222222222222',
    startedAt: null,
    minutes: 30,
    workDate: '2026-09-06',
    description: null,
    isBillable: false,
    hourlyRate: null,
    currency: null,
    invoiceLineItemId: null,
    approvedBy: null,
    approvedAt: null,
    ...overrides,
  };
}

describe('TasksTimeLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new TasksTimeLsCommand(settings, clients);

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

  it('renders a table with DATE, MINUTES, BILLABLE, DESCRIPTION columns', async () => {
    get.mockResolvedValue({
      data: [entry({ workDate: '2026-09-06', minutes: 45, isBillable: true, description: 'Pairing' })],
      total: 1,
      page: 1,
      limit: 50,
    });

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('DATE');
    expect(text).toContain('MINUTES');
    expect(text).toContain('BILLABLE');
    expect(text).toContain('DESCRIPTION');
    expect(text).toContain('2026-09-06');
    expect(text).toContain('45');
    expect(text).toContain('Pairing');
    // Never a bare id in the human table.
    expect(text).not.toContain('eeeeeeee-5555-5555-5555-555555555555');
  });

  it('resolves --project and --task before querying', async () => {
    const projectPage = {
      data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
      total: 1,
      page: 1,
      limit: 100,
    };
    get
      // --project CYB -> lookupProjectByKey
      .mockResolvedValueOnce(projectPage)
      // --task CYB-3 -> taskByProjectAndNumber resolves the project again internally...
      .mockResolvedValueOnce(projectPage)
      // ...then pages /tasks?projectId=... to find number 3
      .mockResolvedValueOnce({
        data: [{ id: 'eeeeeeee-5555-5555-5555-555555555555', number: 3, title: 'x', projectId: 'aaaaaaaa-1111-1111-1111-111111111111' }],
        total: 1,
        page: 1,
        limit: 25,
      })
      // GET /tasks/time?...
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], { project: 'CYB', task: 'CYB-3' });

    const calledPath = get.mock.calls[3][0] as string;
    expect(calledPath).toContain('projectId=aaaaaaaa-1111-1111-1111-111111111111');
    expect(calledPath).toContain('taskId=eeeeeeee-5555-5555-5555-555555555555');
  });

  it('passes through userId, from, to, page, limit as query params', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], { userId: 'user-1', from: '2026-09-01', to: '2026-09-30', page: 2, limit: 10 });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('userId=user-1');
    expect(calledPath).toContain('from=2026-09-01');
    expect(calledPath).toContain('to=2026-09-30');
    expect(calledPath).toContain('page=2');
    expect(calledPath).toContain('limit=10');
  });

  it('prints an empty-state message when there are no entries', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });

    await make().run([], {});

    expect(out.join('')).toContain('No time entries');
  });

  it('--json emits the raw envelope, unmodified', async () => {
    const envelope = { data: [entry()], total: 1, page: 1, limit: 50 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages rather than staying silent', async () => {
    get.mockResolvedValue({ data: [entry()], total: 3, page: 1, limit: 1 });

    await make().run([], {});

    expect(out.join('')).toContain('2 more record');
  });
});
