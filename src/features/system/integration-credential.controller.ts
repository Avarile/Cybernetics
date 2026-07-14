import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createIntegrationSchema,
  type CreateIntegrationDto,
} from './dto/create-integration.dto';
import {
  integrationQuerySchema,
  type IntegrationQueryDto,
  updateIntegrationSchema,
  type UpdateIntegrationDto,
} from './dto/update-integration.dto';
import { IntegrationCredentialService } from './integration-credential.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@Controller('system/integrations')
export class IntegrationCredentialController {
  constructor(private readonly integrations: IntegrationCredentialService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: user.id, ip, userAgent: ua ?? null };
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createIntegrationSchema))
    dto: CreateIntegrationDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.integrations.create(dto, this.ctx(user, ip, ua));
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(integrationQuerySchema))
    query: IntegrationQueryDto,
  ) {
    return this.integrations.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateIntegrationSchema))
    dto: UpdateIntegrationDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.integrations.update(id, dto, this.ctx(user, ip, ua));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.integrations.remove(id, this.ctx(user, ip, ua));
  }
}
