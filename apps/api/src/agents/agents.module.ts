import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database';
import { IdentityModule } from '../identity/identity.module';
import { AgentScopeGuard } from './agent-auth';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import {
  DnsResolver,
  SystemDnsResolver,
  UrlSafetyService,
} from './url-safety.service';
import {
  FetchWebhookChallengeAdapter,
  WebhookChallengePort,
} from './webhook-challenge';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    AgentScopeGuard,
    UrlSafetyService,
    { provide: DnsResolver, useClass: SystemDnsResolver },
    { provide: WebhookChallengePort, useClass: FetchWebhookChallengeAdapter },
  ],
})
export class AgentsModule {}
