import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Principal } from '../../../common/principal';
import { DecisionDto } from '../dto/approval.dto';
import { ApprovalService } from '../services/approval.service';

@Controller('agent/approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get()
  list(@CurrentUser() user: Principal) {
    return this.approvals.listForOwner(user);
  }

  @Post(':id')
  decide(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.approvals.decide(user, id, dto);
  }
}
