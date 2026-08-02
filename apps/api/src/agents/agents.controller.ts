import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, HumanAuthGuard } from '../identity/auth';
import { AgentRequest, AgentScopeGuard, AgentScopes } from './agent-auth';
import {
  HeartbeatDto,
  PatchAgentDto,
  RotateKeyDto,
  SubscribeAgentDto,
  VerifyAgentDto,
} from './agents.dto';
import { AgentsService } from './agents.service';

@Controller('v1/agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Post('subscribe')
  @UseGuards(HumanAuthGuard)
  subscribe(@Req() req: AuthenticatedRequest, @Body() dto: SubscribeAgentDto) {
    return this.agents.subscribe(req.user!.id, dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyAgentDto) {
    return this.agents.activate(dto.challenge, dto.signature);
  }

  @Get('me')
  @UseGuards(AgentScopeGuard)
  @AgentScopes('agent:read')
  me(@Req() req: AgentRequest) {
    return this.agents.getMine(req.agent!.id);
  }

  @Patch('me')
  @UseGuards(AgentScopeGuard)
  @AgentScopes('agent:write')
  patch(@Req() req: AgentRequest, @Body() dto: PatchAgentDto) {
    return this.agents.patch(req.agent!.id, dto);
  }

  @Post('heartbeat')
  @UseGuards(AgentScopeGuard)
  @AgentScopes('agent:heartbeat')
  heartbeat(@Req() req: AgentRequest, @Body() dto: HeartbeatDto) {
    return this.agents.heartbeat(req.agent!.id, dto);
  }

  @Post('keys/rotate')
  @UseGuards(AgentScopeGuard)
  @AgentScopes('agent:keys')
  rotate(@Req() req: AgentRequest, @Body() dto: RotateKeyDto) {
    return this.agents.rotateKey(req.agent!.id, dto.scopes);
  }

  @Get()
  list() {
    return this.agents.list();
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.agents.bySlug(slug);
  }
}
