import { Module } from '@nestjs/common';
import { LEDGER_PORT, UnconfiguredLedgerPort } from '../ledger/ledger.port';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
@Module({
  controllers: [DeliveriesController],
  providers: [
    DeliveriesService,
    { provide: LEDGER_PORT, useClass: UnconfiguredLedgerPort },
  ],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
