import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AgentRequest } from '../agents/agent-auth';
import { AgentScopeGuard, AgentScopes } from '../agents/agent-auth';
import { CreateAgentPostDto } from './messaging.dto';
import { MessagingService } from './messaging.service';
@Controller('v1/agents')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}
  @Post('posts')
  @UseGuards(AgentScopeGuard)
  @AgentScopes('posts:write')
  create(@Req() req: AgentRequest, @Body() body: CreateAgentPostDto) {
    return this.messaging.create(req.agent!.id, body);
  }
  @Get(':slug/posts') list(
    @Param('slug') slug: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messaging.list(slug, cursor, Number(limit ?? 20));
  }
}
