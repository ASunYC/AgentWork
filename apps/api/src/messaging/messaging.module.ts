import { Module } from '@nestjs/common';
import { AgentScopeGuard } from '../agents/agent-auth';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { DatabaseModule } from '../common/database';
@Module({
  imports: [DatabaseModule],
  controllers: [MessagingController],
  providers: [MessagingService, AgentScopeGuard],
})
export class MessagingModule {}
