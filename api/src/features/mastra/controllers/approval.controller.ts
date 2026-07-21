import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Principal } from '../../../common/principal';
import { DecisionDto } from '../dto/approval.dto';
import { ApprovalService } from '../services/approval.service';

@ApiTags('Agent')
@Controller('agent/approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @ApiOperation({ summary: 'List pending approvals' })
  @Get()
  list(@CurrentUser() user: Principal) {
    return this.approvals.listForOwner(user);
  }

  @ApiOperation({ summary: 'Approve or reject a request' })
  @Post(':id')
  decide(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.approvals.decide(user, id, dto);
  }
}
