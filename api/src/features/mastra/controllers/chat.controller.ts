import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Principal } from '../../../common/principal';
import { ChatDto } from '../dto/chat.dto';
import { AgentRunnerService } from '../services/agent-runner.service';
import { ConversationMessagesService } from '../services/conversation-messages.service';
import { ConversationService } from '../services/conversation.service';

@ApiTags('Agent')
@Controller('agent')
export class ChatController {
  constructor(
    private readonly runner: AgentRunnerService,
    private readonly conversations: ConversationService,
    private readonly conversationMessages: ConversationMessagesService,
  ) {}

  @ApiOperation({ summary: 'Send chat message to agent' })
  @Post('chat')
  chat(@CurrentUser() user: Principal, @Body() dto: ChatDto) {
    return this.runner.runChat(user, dto);
  }

  @ApiOperation({ summary: 'List agent conversations' })
  @Get('conversations')
  list(
    @CurrentUser() user: Principal,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.conversations.listForOwner(user, Number(page), Number(limit));
  }

  @ApiOperation({ summary: 'Get messages for a conversation' })
  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversationMessages.list(user, id);
  }
}
