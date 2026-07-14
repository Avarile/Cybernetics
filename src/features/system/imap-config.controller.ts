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
import { createImapSchema, type CreateImapDto } from './dto/create-imap.dto';
import { listQuerySchema, type ListQueryDto } from './dto/list-query.dto';
import { updateImapSchema, type UpdateImapDto } from './dto/update-imap.dto';
import { ImapConfigService } from './imap-config.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@Controller('system/imap')
export class ImapConfigController {
  constructor(private readonly imap: ImapConfigService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: user.id, ip, userAgent: ua ?? null };
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createImapSchema)) dto: CreateImapDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.create(dto, this.ctx(user, ip, ua));
  }

  @Get()
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto) {
    return this.imap.list(query.page, query.limit);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imap.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateImapSchema)) dto: UpdateImapDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.update(id, dto, this.ctx(user, ip, ua));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.imap.remove(id, this.ctx(user, ip, ua));
  }

  @Post(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.activate(id, this.ctx(user, ip, ua));
  }

  @Post(':id/test')
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.test(id, this.ctx(user, ip, ua));
  }
}
