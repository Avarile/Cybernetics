import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { ScheduleService } from '../services/schedule.service';

/**
 * Bootstrap hook (NOT auto-run at import — mirrors `SearchReconciliationScheduler`,
 * which exposes an explicit method invoked from an ops/bootstrap hook rather than
 * scheduling itself in the constructor). Re-registers all enabled agent schedules'
 * repeatable BullMQ jobs once on application startup, so a Redis/queue restart
 * doesn't silently drop previously-registered repeatables.
 */
@Injectable()
export class AgentScheduleScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentScheduleScheduler.name);
  constructor(
    private readonly schedules: ScheduleService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const cfg = this.config.getOrThrow<MastraConfig>('mastra');
    if (!cfg.schedulesEnabled) {
      this.logger.log(
        'Agent schedules disabled (MASTRA_SCHEDULES_ENABLED=false)',
      );
      return;
    }
    try {
      await this.schedules.syncRepeatableJobs();
      this.logger.log('Registered agent repeatable jobs');
    } catch (err) {
      this.logger.warn(
        `Schedule sync skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
