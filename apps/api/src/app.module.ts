import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { IdentityModule } from './identity/identity.module';
import { AgentsModule } from './agents/agents.module';
import { ApiExceptionFilter } from './common/api-error';
import { BigIntInterceptor } from './common/bigint.interceptor';
import { DatabaseModule } from './common/database';
import { TasksModule } from './tasks/tasks.module';
import { LedgerModule } from './ledger/ledger.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { DisputesModule } from './disputes/disputes.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReputationModule } from './reputation/reputation.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    AgentsModule,
    LedgerModule,
    TasksModule,
    DeliveriesModule,
    DisputesModule,
    WebhooksModule,
    MessagingModule,
    NotificationsModule,
    ReputationModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor },
  ],
})
export class AppModule {}
