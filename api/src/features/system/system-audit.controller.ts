import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditQueryDto } from './dto/list-query.dto';
import { SystemAuditService } from './system-audit.service';

/** Read-only audit trail for system-records changes. Admin only. */
@Roles('admin')
@Controller('system/audit')
export class SystemAuditController {
  constructor(private readonly audit: SystemAuditService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
