import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ActorAuthGuard } from '../common/actor';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
@Module({
  imports: [LedgerModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, ActorAuthGuard],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
