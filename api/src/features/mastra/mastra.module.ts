import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MastraModule as MastraCoreModule,
  MastraService,
} from '@mastra/nestjs';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infrastructure/database/drizzle.constants';
import type { MastraConfig } from '../../config/configurations/mastra.config';
import { SearchServiceModule } from '../search-service/search-service.module';
import { SearchRecordService } from '../search-service/search-record.service';
import { MailerService } from '../../infrastructure/email/mailer.service';
import { EmailModule } from '../../infrastructure/email/email.module';
import { buildMastra } from './index';
import { AGENT_RUN_QUEUE, THREAD_STORE } from './mastra.constants';
import type { ThreadStore, ToolServices } from './mastra.types';
import { ChatController } from './controllers/chat.controller';
import { ApprovalController } from './controllers/approval.controller';
import { ScheduleController } from './controllers/schedule.controller';
import { SystemAuditModule } from '../system/system-audit.module';
import { MastraRepositoriesModule } from './mastra-repositories.module';
import { ActionLogRepository } from './repositories/action-log.repository';
import { ConversationMessagesService } from './services/conversation-messages.service';
import { ConversationService } from './services/conversation.service';
import { AgentRunnerService } from './services/agent-runner.service';
import { ChatStreamService } from './services/chat-stream.service';
import { ApprovalService } from './services/approval.service';
import { ScheduleService } from './services/schedule.service';
import { AgentRunProcessor } from './processors/agent-run.processor';
import { AgentScheduleScheduler } from './schedulers/agent-schedule.scheduler';

/**
 * Mastra AI feature module.
 *
 * Registers the app-lifetime `Mastra` instance (agent + scheduled-report
 * workflow, Postgres-backed storage) with the `@mastra/nestjs` adapter via
 * `registerAsync`, which exposes `MastraService` for injection and mounts the
 * adapter's own routes under the `prefix` below. `ConfigService` and
 * `PG_POOL` are available for injection without importing their modules
 * here because `ConfigModule` and `DatabaseModule` are both `@Global()`.
 *
 * `prefix: '/api/agent-core'` scopes the adapter's catch-all controller away
 * from this module's own `/agent/*` routes (chat/approvals/schedules) — see
 * `MastraModuleOptions.prefix` (default `/api`) in
 * `node_modules/@mastra/nestjs/dist/mastra.module.d.ts`.
 *
 * NOTE: this module MUST be imported last in `AppModule` — the adapter mounts
 * a catch-all controller that would otherwise intercept unrelated routes.
 */
@Module({
  imports: [
    SearchServiceModule,
    EmailModule,
    MastraRepositoriesModule,
    SystemAuditModule,
    QueueModule,
    BullModule.registerQueue({ name: AGENT_RUN_QUEUE }),
    MastraCoreModule.registerAsync({
      imports: [SearchServiceModule, EmailModule, MastraRepositoriesModule],
      inject: [
        ConfigService,
        SearchRecordService,
        MailerService,
        ActionLogRepository,
        PG_POOL,
      ],
      useFactory: (
        config: ConfigService,
        search: SearchRecordService,
        mailer: MailerService,
        actionLog: ActionLogRepository,
        pool: Pool,
      ) => {
        const cfg = config.getOrThrow<MastraConfig>('mastra');
        const services: ToolServices = {
          searchRecords: search,
          sendEmail: (m) => mailer.send(m),
          recordAction: (e) => actionLog.record(e),
        };
        return {
          mastra: buildMastra({ cfg, pool, services }),
          prefix: '/api/agent-core',
        };
      },
    }),
  ],
  controllers: [ChatController, ApprovalController, ScheduleController],
  providers: [
    {
      /**
       * Binds the thread-purge port. Lives here rather than in
       * `ConversationService` so that service never imports `@mastra/nestjs` —
       * see the note on THREAD_STORE in mastra.constants.ts.
       *
       * `getStore('memory')` yields the storage-domain memory store, whose
       * `deleteThread` takes `{ threadId }` (not the bare string the `Memory`
       * class takes). Under `@mastra/pg` it deletes the messages and the thread
       * in one transaction.
       */
      provide: THREAD_STORE,
      inject: [MastraService],
      useFactory: (mastra: MastraService): ThreadStore => ({
        async deleteThread(threadId: string): Promise<void> {
          const store = mastra.getMastra().getStorage();
          const memory = await store?.getStore('memory');
          await memory?.deleteThread({ threadId });
        },
      }),
    },
    ConversationService,
    ConversationMessagesService,
    AgentRunnerService,
    ChatStreamService,
    ApprovalService,
    ScheduleService,
    AgentRunProcessor,
    AgentScheduleScheduler,
  ],
})
export class MastraModule {}
