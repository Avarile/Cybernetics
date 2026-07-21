import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ListMessagesDto } from './dto/list-messages.dto';
import { MarkSeenDto } from './dto/mark-seen.dto';
import { SyncDto } from './dto/sync.dto';
import { MailboxService } from './mailbox.service';

@Roles('admin')
@Controller('mailbox')
export class MailboxController {
  constructor(private readonly mailbox: MailboxService) {}

  @Get('messages')
  list(@Query() q: ListMessagesDto) {
    const accountId = this.mailbox.resolveAccountId(q.accountId);
    return this.mailbox.list(
      accountId,
      q.mailbox,
      q.page,
      q.limit,
      q.unseenOnly,
    );
  }

  @Get('messages/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailbox.get(id);
  }

  @Get('messages/:id/attachments/:attId/download')
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attId', ParseUUIDPipe) attId: string,
  ) {
    return this.mailbox.downloadAttachment(id, attId);
  }

  @Patch('messages/:id/seen')
  @HttpCode(204)
  async markSeen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MarkSeenDto,
  ): Promise<void> {
    await this.mailbox.markSeen(id, body.seen);
  }

  @Post('sync')
  @HttpCode(202)
  async sync(@Body() body: SyncDto): Promise<{ queued: true }> {
    const accountId = this.mailbox.resolveAccountId(body.accountId);
    await this.mailbox.triggerSync(accountId, body.mailbox);
    return { queued: true };
  }
}
