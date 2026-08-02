import { Global, Module } from '@nestjs/common';
import { DomainEventPublisherPort, PrismaDomainEventPublisher } from './domain-event.publisher';
import { AdminGuard, AdminWebhooksController } from './admin-webhooks.controller';
import { DatabaseModule } from '../common/database';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: DomainEventPublisherPort, useClass: PrismaDomainEventPublisher }, AdminGuard],
  controllers: [AdminWebhooksController],
  exports: [DomainEventPublisherPort],
})
export class WebhooksModule {}
