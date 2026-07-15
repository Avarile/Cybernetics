import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  AGENT_RUN_JOB_OPTS,
  AGENT_RUN_QUEUE,
  RUN_SCHEDULE_JOB,
} from '../mastra.constants';
import { ScheduleRepository } from '../repositories/schedule.repository';

export interface CreateScheduleInput {
  name: string;
  cron: string;
  agentId: string;
  promptTemplate: string;
  timezone?: string;
  params?: Record<string, unknown>;
  description?: string;
  deliveryChannel?: string;
  deliveryTarget?: string;
  targetUserId?: string;
  enabled?: boolean;
}

/**
 * Registers/unregisters BullMQ job schedulers for admin-managed agent schedules.
 *
 * CONFIRMED (`node_modules/bullmq` `dist/esm/classes/queue.d.ts` L193-198,
 * installed version 5.80.2): `upsertJobScheduler(jobSchedulerId: NameType,
 * repeatOpts: Omit<RepeatOptions, 'key'>, jobTemplate?: { name?: NameType;
 * data?: DataType; opts?: JobSchedulerTemplateOptions }): Promise<Job<...>>`
 * is idempotent — calling it again with the same `jobSchedulerId` updates the
 * existing scheduler rather than creating a duplicate, which is what makes
 * `syncRepeatableJobs()` safe to re-run on every boot. `removeJobScheduler
 * (jobSchedulerId: string): Promise<boolean>` (L293) removes by id alone, so
 * unlike the old `removeRepeatable(name, repeatOpts, jobId?)` there is no need
 * to replay the original repeat options to unregister the cron entry.
 *
 * `RepeatOptions` (`dist/esm/interfaces/repeat-options.d.ts`) exposes both
 * `pattern` (cron string, parsed via `cron-parser`) and `every` (fixed-interval
 * ms) as mutually exclusive fields — `search-reconciliation.scheduler.ts` uses
 * `every` for its fixed sweep interval; this service uses `pattern` because
 * agent schedules are defined by admin-supplied cron expressions. `tz` (also
 * from `Omit<ParserOptions, 'iterator'>`) carries the schedule's timezone into
 * the cron parser.
 *
 * `JobSchedulerTemplateOptions` (`dist/esm/types/job-scheduler-template-
 * options.d.ts`) is `Omit<JobsOptions, 'jobId' | 'repeat' | 'delay' |
 * 'deduplication' | 'debounce'>` — `AGENT_RUN_JOB_OPTS` (`attempts`,
 * `backoff`, `removeOnComplete`, `removeOnFail`) uses none of the excluded
 * fields, so it plugs into `opts` without a cast.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly repo: ScheduleRepository,
    @InjectQueue(AGENT_RUN_QUEUE) private readonly queue: Queue,
  ) {}

  private async register(s: { id: string; cron: string; timezone?: string }) {
    await this.queue.upsertJobScheduler(
      s.id,
      { pattern: s.cron, tz: s.timezone },
      {
        name: RUN_SCHEDULE_JOB,
        data: { scheduleId: s.id },
        opts: AGENT_RUN_JOB_OPTS,
      },
    );
  }

  async create(dto: CreateScheduleInput) {
    const row = await this.repo.create(dto as never);
    if (row.enabled) await this.register(row);
    return row;
  }

  async syncRepeatableJobs() {
    const rows = await this.repo.listEnabled();
    for (const r of rows) await this.register(r);
  }

  async remove(id: string) {
    await this.repo.softDelete(id);
    await this.queue.removeJobScheduler(id);
  }
}
