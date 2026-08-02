import { Module } from '@nestjs/common';
import { AgentScopeGuard } from '../agents/agent-auth';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
@Module({ controllers: [MessagingController], providers: [MessagingService, AgentScopeGuard] })
export class MessagingModule {}
