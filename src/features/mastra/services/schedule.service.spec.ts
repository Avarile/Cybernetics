import { ScheduleService } from './schedule.service';

function make() {
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'sch-1', enabled: true, ...v })),
    listEnabled: jest.fn(async () => [
      { id: 'sch-1', cron: '*/5 * * * *', enabled: true },
    ]),
    findLiveById: jest.fn(async () => ({ id: 'sch-1', cron: '*/5 * * * *' })),
    softDelete: jest.fn(async () => undefined),
  };
  const queue = {
    add: jest.fn(async () => undefined),
    removeRepeatable: jest.fn(async () => undefined),
  };
  return {
    service: new ScheduleService(repo as never, queue as never),
    repo,
    queue,
  };
}

describe('ScheduleService', () => {
  it('creates a schedule and registers a repeatable job when enabled', async () => {
    const { service, queue } = make();
    await service.create({
      name: 'daily',
      cron: '0 9 * * *',
      agentId: 'orchestrator',
      promptTemplate: 'report',
    } as any);
    expect(queue.add).toHaveBeenCalledWith(
      'run-schedule',
      expect.objectContaining({ scheduleId: 'sch-1' }),
      expect.objectContaining({
        jobId: 'sch-1',
        repeat: expect.objectContaining({ pattern: '0 9 * * *' }),
      }),
    );
  });

  it('syncRepeatableJobs registers all enabled schedules', async () => {
    const { service, queue } = make();
    await service.syncRepeatableJobs();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
