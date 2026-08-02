import { Global, Module } from '@nestjs/common';
import { DomainEventPublisherPort, PrismaDomainEventPublisher } from './domain-event.publisher';
import { AdminGuard, AdminWebhooksController } from './admin-webhooks.controller';

@Global()
@Module({
  providers: [{ provide: DomainEventPublisherPort, useClass: PrismaDomainEventPublisher }, AdminGuard],
  controllers: [AdminWebhooksController],
  exports: [DomainEventPublisherPort],
})
export class WebhooksModule {}
