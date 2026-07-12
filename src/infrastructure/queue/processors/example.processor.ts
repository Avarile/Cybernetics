import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DEFAULT_QUEUE } from '../queue.constants';

/**
 * Example job processor. Real processors extend `WorkerHost` and implement
 * `process`; register one per queue.
 */
@Processor(DEFAULT_QUEUE)
export class ExampleProcessor extends WorkerHost {
  private readonly logger = new Logger(ExampleProcessor.name);

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing job ${job.id ?? '?'} (${job.name})`);
    // Job handling logic goes here.
  }
}
