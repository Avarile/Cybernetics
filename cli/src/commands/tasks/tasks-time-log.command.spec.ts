import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { TasksTimeLogCommand } from './tasks-time-log.command';

describe('TasksTimeLogCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const TASK_ID = 'eeeeeeee-5555-5555-5555-555555555555';

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new TasksTimeLogCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn();
    post = jest.fn().mockResolvedValue({
      id: 'ffffffff-6666-6666-6666-666666666666',
      taskId: TASK_ID,
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
    });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the address and logs time with the given flags', async () => {
    await make().run([TASK_ID], { minutes: 30, workDate: '2026-09-06' });

    expect(post).toHaveBeenCalledWith(`/tasks/${TASK_ID}/time`, { minutes: 30, workDate: '2026-09-06' });
    expect(out.join('')).toContain('30 minute');
  });

  it('maps --billable to isBillable and passes through the rest', async () => {
    await make().run([TASK_ID], {
      minutes: 30,
      workDate: '2026-09-06',
      startedAt: '2026-09-06T09:00:00Z',
      description: 'Pairing',
      billable: true,
      hourlyRate: '50.00',
      currency: 'USD',
    });

    expect(post).toHaveBeenCalledWith(`/tasks/${TASK_ID}/time`, {
      minutes: 30,
      workDate: '2026-09-06',
      startedAt: '2026-09-06T09:00:00Z',
      description: 'Pairing',
      isBillable: true,
      hourlyRate: '50.00',
      currency: 'USD',
    });
  });

  it('requires --minutes', async () => {
    await expect(make().run([TASK_ID], { workDate: '2026-09-06' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('requires --work-date', async () => {
    await expect(make().run([TASK_ID], { minutes: 30 })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });
});
