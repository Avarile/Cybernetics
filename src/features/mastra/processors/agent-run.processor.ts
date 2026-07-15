import { Processor, WorkerHost } from '@nestjs/bullmq';
import { MastraService } from '@mastra/nestjs';
import type { Job } from 'bullmq';
import {
  AGENT_RUN_QUEUE,
  RUN_SCHEDULE_JOB,
  SCHEDULED_REPORT_WORKFLOW_ID,
} from '../mastra.constants';
import { ScheduleRepository } from '../repositories/schedule.repository';
import { AgentRunRepository } from '../repositories/agent-run.repository';

/**
 * Consumes `run-schedule` jobs off `AGENT_RUN_QUEUE`: loads the live schedule,
 * ledgers an `agent_run` row, runs the scheduled-report workflow, and stamps
 * the outcome back onto both the run and the schedule.
 *
 * CONFIRMED against installed types (`node_modules/@mastra/nestjs/dist/mastra.service.d.ts`
 * L45 `getWorkflow(workflowId: string): AnyWorkflow`; `node_modules/@mastra/core/dist/
 * workflows/workflow.d.ts` L237 `createRun(options?): Promise<Run<...>>` and L320
 * `readonly runId: string` on `Run`, L431 `start(args: { inputData, ... }):
 * Promise<WorkflowResult<...>>`): `getWorkflow` / `createRun` / `start({ inputData })`
 * and `runHandle.runId` are all real, non-cast APIs — matches the brief as written.
 */
@Processor(AGENT_RUN_QUEUE)
export class AgentRunProcessor extends WorkerHost {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly runs: AgentRunRepository,
    private readonly mastra: MastraService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== RUN_SCHEDULE_JOB) return;
    const schedule = await this.schedules.findLiveById(
      job.data.scheduleId as string,
    );
    if (!schedule || !schedule.enabled) return;
    const run = await this.runs.create({
      trigger: 'schedule',
      status: 'running',
      agentId: schedule.agentId,
      input: { scheduleId: schedule.id },
      startedAt: new Date(),
    } as never);
    try {
      const wf = this.mastra.getWorkflow(SCHEDULED_REPORT_WORKFLOW_ID);
      const runHandle = await wf.createRun();
      const result = await runHandle.start({
        inputData: {
          scheduleId: schedule.id,
          userId: schedule.targetUserId ?? null,
          promptTemplate: schedule.promptTemplate,
          params: schedule.params,
          deliveryChannel: schedule.deliveryChannel,
          deliveryTarget: schedule.deliveryTarget,
        },
      } as never);
      await this.runs.finish(run.id, {
        status: 'succeeded',
        output: result as never,
        mastraRunId: runHandle.runId ?? null,
        finishedAt: new Date(),
      });
      await this.schedules.stampRun(schedule.id, 'succeeded', run.id);
    } catch (err) {
      await this.runs.finish(run.id, {
        status: 'failed',
        error: { message: err instanceof Error ? err.message : String(err) },
        finishedAt: new Date(),
      });
      await this.schedules.stampRun(schedule.id, 'failed', run.id);
      throw err; // let BullMQ retry
    }
  }
}
