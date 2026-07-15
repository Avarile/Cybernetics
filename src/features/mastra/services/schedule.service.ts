import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AGENT_RUN_QUEUE, RUN_SCHEDULE_JOB } from '../mastra.constants';
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
 * Registers/unregisters BullMQ repeatable jobs for admin-managed agent schedules.
 *
 * CONFIRMED (`node_modules/bullmq` `dist/esm/interfaces/repeat-options.d.ts`): the
 * `RepeatOptions` interface exposes both `pattern` (cron string, parsed via
 * `cron-parser`) and `every` (fixed-interval ms) as mutually exclusive fields —
 * `search-reconciliation.scheduler.ts` uses `every` for its fixed sweep interval;
 * this service uses `pattern` because agent schedules are defined by admin-supplied
 * cron expressions. `tz` (also from `Omit<ParserOptions, 'iterator'>`) carries the
 * schedule's timezone into the cron parser.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly repo: ScheduleRepository,
    @InjectQueue(AGENT_RUN_QUEUE) private readonly queue: Queue,
  ) {}

  private async register(s: { id: string; cron: string; timezone?: string }) {
    await this.queue.add(RUN_SCHEDULE_JOB, { scheduleId: s.id }, {
      jobId: s.id,
      repeat: { pattern: s.cron, tz: s.timezone },
      removeOnComplete: true,
      removeOnFail: true,
    } as never);
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
    await this.queue.removeRepeatable(RUN_SCHEDULE_JOB, { jobId: id } as never);
  }
}
