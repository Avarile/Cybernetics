import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Principal } from '../../../common/principal';
import { ChatDto } from '../dto/chat.dto';
import { AgentRunnerService } from '../services/agent-runner.service';
import { ConversationService } from '../services/conversation.service';

@Controller('agent')
export class ChatController {
  constructor(
    private readonly runner: AgentRunnerService,
    private readonly conversations: ConversationService,
  ) {}

  @Post('chat')
  chat(@CurrentUser() user: Principal, @Body() dto: ChatDto) {
    return this.runner.runChat(user, dto);
  }

  @Get('conversations')
  list(
    @CurrentUser() user: Principal,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.conversations.listForOwner(user, Number(page), Number(limit));
  }
}
