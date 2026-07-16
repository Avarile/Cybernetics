import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Principal } from '../../../common/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { decisionSchema, type DecisionDto } from '../dto/approval.dto';
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
    @Body(new ZodValidationPipe(decisionSchema)) dto: DecisionDto,
  ) {
    return this.approvals.decide(user, id, dto);
  }
}
