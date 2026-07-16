import { Injectable, Logger } from '@nestjs/common';
import type { SystemAuditRow } from '../../infrastructure/database/schema/system.schema';
import {
  SystemAuditRepository,
  type AuditListQuery,
} from './system-audit.repository';
import type { RecordAuditInput } from './system-audit.types';

@Injectable()
export class SystemAuditService {
  private readonly logger = new Logger(SystemAuditService.name);

  constructor(private readonly repo: SystemAuditRepository) {}

  /** Best-effort: audit failures are logged, never bubbled to the caller. */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.repo.insert({
        actorId: input.ctx.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
        ip: input.ctx.ip ?? null,
        userAgent: input.ctx.userAgent ?? null,
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit row for ${input.action}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async list(q: AuditListQuery): Promise<{
    data: SystemAuditRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { rows, total } = await this.repo.list(q);
    return { data: rows, total, page: q.page, limit: q.limit };
  }
}
