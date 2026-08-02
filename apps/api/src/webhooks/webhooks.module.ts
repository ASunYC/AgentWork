import { Global, Module } from '@nestjs/common';
import { DomainEventPublisherPort, PrismaDomainEventPublisher } from './domain-event.publisher';

@Global()
@Module({
  providers: [{ provide: DomainEventPublisherPort, useClass: PrismaDomainEventPublisher }],
  exports: [DomainEventPublisherPort],
})
export class WebhooksModule {}
