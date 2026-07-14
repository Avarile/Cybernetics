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
import { createSmtpSchema, type CreateSmtpDto } from './dto/create-smtp.dto';
import { listQuerySchema, type ListQueryDto } from './dto/list-query.dto';
import { updateSmtpSchema, type UpdateSmtpDto } from './dto/update-smtp.dto';
import { SmtpConfigService } from './smtp-config.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@Controller('system/smtp')
export class SmtpConfigController {
  constructor(private readonly smtp: SmtpConfigService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: user.id, ip, userAgent: ua ?? null };
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createSmtpSchema)) dto: CreateSmtpDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.create(dto, this.ctx(user, ip, ua));
  }

  @Get()
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto) {
    return this.smtp.list(query.page, query.limit);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.smtp.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSmtpSchema)) dto: UpdateSmtpDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.update(id, dto, this.ctx(user, ip, ua));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.smtp.remove(id, this.ctx(user, ip, ua));
  }

  @Post(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.activate(id, this.ctx(user, ip, ua));
  }

  @Post(':id/test')
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.test(id, this.ctx(user, ip, ua));
  }
}
